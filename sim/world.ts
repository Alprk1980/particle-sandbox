import {
  EMPTY, WALL, WOOD, METAL, STONE, GLASS, ICE, WATER, OIL, ACID, STEAM, SAND, PLANT, SEED, LEAF, FIRE,
  C4, SPARK, LAVA, SMOKE, ASH, RUBBLE, SHARD, BUILDING, WINDOW, ROAD, WIRE, GENERATOR, DRYPLANT,
  KIND, K_STATIC, K_POWDER, K_LIQUID, K_GAS, K_ENERGY,
  DENSITY, RIGID, FLAMMABLE, BURN_TIME, DISSOLVE, CONDUCTIVE, FLOATS, FRAGILE,
} from './elements';

export interface Projectile {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
}

interface Pending {
  i: number;
  t: number;
}

export const HEAD = 3; // electric pulse head; 2,1 are refractory tail states
const MAX_PROJECTILES = 2500;
export const QUAKE_DURATION = 300;
export const FLOOD_DURATION = 720;
export const ERUPT_DURATION = 660;

const DX8 = [-1, 0, 1, -1, 1, -1, 0, 1];
const DY8 = [-1, -1, -1, 0, 0, 1, 1, 1];

const rnd = Math.random;

export class World {
  readonly w: number;
  readonly h: number;
  readonly size: number;

  type: Uint8Array;
  life: Int16Array;
  shade: Uint8Array;
  burn: Uint16Array;
  charge: Uint8Array;
  private chargeNext: Uint8Array;
  fall: Uint8Array;
  private stamp: Uint8Array;
  windX: Float32Array;
  windY: Float32Array;

  // rigid-body scratch buffers
  private comp: Int32Array;
  private stack: Int32Array;
  private supported = new Uint8Array(1024);
  private edgeFrom: Int32Array;
  private edgeTo: Int32Array;

  frame = 0;
  private sv = 0;
  projectiles: Projectile[] = [];
  private pending: Pending[] = [];

  // environment
  rain = false;
  windOn = false;
  windStrength = 0.6;
  heatwave = false;
  quakeTimer = 0;
  floodTimer = 0;
  eruptTimer = 0;
  vent: { x: number; y: number } | null = null;
  shake = 0;
  windFieldTimer = 0;

  rigidCount = 0;
  private anyCharge = false;
  private hasGenerator = false;
  private gWind = 0;

  constructor(w: number, h: number) {
    this.w = w;
    this.h = h;
    const n = (this.size = w * h);
    this.type = new Uint8Array(n);
    this.life = new Int16Array(n);
    this.shade = new Uint8Array(n);
    this.burn = new Uint16Array(n);
    this.charge = new Uint8Array(n);
    this.chargeNext = new Uint8Array(n);
    this.fall = new Uint8Array(n);
    this.stamp = new Uint8Array(n);
    this.windX = new Float32Array(n);
    this.windY = new Float32Array(n);
    this.comp = new Int32Array(n);
    this.stack = new Int32Array(n);
    this.edgeFrom = new Int32Array(n);
    this.edgeTo = new Int32Array(n);
  }

  get heatMul() {
    return this.heatwave ? 2.2 : 1;
  }

  clear() {
    this.type.fill(0);
    this.life.fill(0);
    this.burn.fill(0);
    this.charge.fill(0);
    this.chargeNext.fill(0);
    this.fall.fill(0);
    this.windX.fill(0);
    this.windY.fill(0);
    this.projectiles.length = 0;
    this.pending.length = 0;
    this.quakeTimer = this.floodTimer = this.eruptTimer = 0;
    this.vent = null;
    this.shake = 0;
    this.rigidCount = 0;
  }

  // ---------------------------------------------------------------- cells

  set(i: number, t: number) {
    this.type[i] = t;
    this.shade[i] = (rnd() * 256) | 0;
    this.burn[i] = 0;
    this.charge[i] = 0;
    this.fall[i] = 0;
    this.stamp[i] = this.sv;
    let l = 0;
    switch (t) {
      case FIRE: l = 20 + rnd() * 35; break;
      case SPARK: l = 10 + rnd() * 18; break;
      case STEAM: l = 250 + rnd() * 350; break;
      case SMOKE: l = 70 + rnd() * 130; break;
    }
    this.life[i] = l | 0;
  }

  place(x: number, y: number, t: number, shade?: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    if (this.type[i] === WALL) return;
    this.set(i, t);
    if (shade !== undefined) this.shade[i] = shade;
  }

  private swap(i: number, j: number) {
    const { type, life, shade, burn, charge, fall } = this;
    let a: number;
    a = type[i]; type[i] = type[j]; type[j] = a;
    a = life[i]; life[i] = life[j]; life[j] = a;
    a = shade[i]; shade[i] = shade[j]; shade[j] = a;
    a = burn[i]; burn[i] = burn[j]; burn[j] = a;
    a = charge[i]; charge[i] = charge[j]; charge[j] = a;
    a = fall[i]; fall[i] = fall[j]; fall[j] = a;
    this.stamp[i] = this.stamp[j] = this.sv;
  }

  /** Random 8-neighbour index, or -1 if off-grid. */
  private rn8(x: number, y: number) {
    const d = (rnd() * 8) | 0;
    const nx = x + DX8[d];
    const ny = y + DY8[d];
    if (nx < 0 || ny < 0 || nx >= this.w || ny >= this.h) return -1;
    return ny * this.w + nx;
  }

  /** Can a particle of type t move into cell j (displacing what is there)? */
  private canEnter(t: number, j: number) {
    const tj = this.type[j];
    if (tj === EMPTY) return true;
    const k = KIND[tj];
    if (k === K_GAS || tj === FIRE) return true;
    if (k === K_LIQUID) return DENSITY[t] > DENSITY[tj];
    return false;
  }

  private windPush(x: number, y: number, i: number, t: number, factor: number) {
    const wx = this.gWind + this.windX[i];
    const wy = this.windY[i];
    if (wx !== 0 && rnd() < Math.abs(wx) * factor) {
      const dx = wx > 0 ? 1 : -1;
      const nx = x + dx;
      if (nx >= 0 && nx < this.w && this.canEnter(t, i + dx)) {
        this.swap(i, i + dx);
        return true;
      }
    }
    if (wy !== 0 && rnd() < Math.abs(wy) * factor) {
      const dy = wy > 0 ? 1 : -1;
      const ny = y + dy;
      if (ny >= 0 && ny < this.h && this.canEnter(t, i + dy * this.w)) {
        this.swap(i, i + dy * this.w);
        return true;
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- step

  step() {
    this.frame++;
    this.sv = this.frame & 255;
    this.gWind = this.windOn ? this.windStrength : 0;
    this.environment();
    if (this.anyCharge || this.hasGenerator) this.electricPass();
    this.caPass();
    this.rigidPass();
    this.updateProjectiles();
    this.processPending();
    this.decayWind();
  }

  private caPass() {
    const { w, h, type, stamp } = this;
    const sv = this.sv;
    let rigid = 0;
    let gen = 0;
    for (let y = h - 1; y >= 0; y--) {
      const ltr = ((y + this.frame) & 1) === 0;
      const row = y * w;
      for (let k = 0; k < w; k++) {
        const x = ltr ? k : w - 1 - k;
        const i = row + x;
        const t = type[i];
        if (t === EMPTY) continue;
        if (RIGID[t]) {
          rigid++;
          if (t === GENERATOR) gen++;
        }
        if (stamp[i] === sv) continue;
        switch (KIND[t]) {
          case K_POWDER: this.updatePowder(x, y, i, t); break;
          case K_LIQUID: this.updateLiquid(x, y, i, t); break;
          case K_GAS: this.updateGas(x, y, i, t); break;
          case K_ENERGY:
            if (t === FIRE) this.updateFire(x, y, i);
            else this.updateSpark(x, y, i);
            break;
          case K_STATIC: this.updateStatic(x, y, i, t); break;
        }
      }
    }
    this.rigidCount = rigid;
    this.hasGenerator = gen > 0;
  }

  // ---------------------------------------------------------------- powders

  private updatePowder(x: number, y: number, i: number, t: number) {
    if (t === LEAF) {
      this.updateLeaf(x, y, i);
      return;
    }
    if (t === SEED && this.trySprout(x, y, i)) return;
    if (this.windPush(x, y, i, t, t === ASH ? 0.6 : t === SEED ? 0.3 : 0.1)) return;
    if (t === ASH && rnd() < 0.5) return;
    const { w, h } = this;
    if (y + 1 < h) {
      const b = i + w;
      if (this.canEnter(t, b)) {
        // sink through liquids more slowly than falling through air
        if (KIND[this.type[b]] !== K_LIQUID || rnd() < 0.5) this.swap(i, b);
        return;
      }
      const dx = rnd() < 0.5 ? -1 : 1;
      if (x + dx >= 0 && x + dx < w && this.canEnter(t, b + dx)) {
        this.swap(i, b + dx);
        return;
      }
      if (x - dx >= 0 && x - dx < w && this.canEnter(t, b - dx)) {
        this.swap(i, b - dx);
        return;
      }
    }
    if (this.quakeTimer > 0 && rnd() < 0.3) {
      const dx = rnd() < 0.5 ? -1 : 1;
      if (x + dx >= 0 && x + dx < w && this.canEnter(t, i + dx)) this.swap(i, i + dx);
    }
  }

  /** Leaves drift down slowly, swaying side to side, and settle where they land. */
  private updateLeaf(x: number, y: number, i: number) {
    if (this.windPush(x, y, i, LEAF, 0.8)) return;
    const { w, h } = this;
    if (y + 1 >= h) return;
    const b = i + w;
    const tb = this.type[b];
    // Resting on something solid or floating on a liquid: stay put.
    if (tb !== EMPTY && KIND[tb] !== K_GAS && tb !== FIRE) {
      if (this.canEnter(LEAF, b) && rnd() < 0.3) this.swap(i, b);
      else this.settleLeaf(x, i, b);
      return;
    }
    if (rnd() < 0.7) return; // airborne: fall at a fraction of normal speed
    // Each leaf sways on its own phase, taken from its (swap-preserved) shade.
    const sway = Math.sin(this.frame * 0.06 + this.shade[i] * 0.1);
    const dx = sway > 0.35 ? 1 : sway < -0.35 ? -1 : 0;
    if (dx !== 0 && x + dx >= 0 && x + dx < w) {
      if (rnd() < 0.35 && this.canEnter(LEAF, i + dx)) {
        this.swap(i, i + dx); // glide sideways
        return;
      }
      if (this.canEnter(LEAF, b + dx)) {
        this.swap(i, b + dx);
        return;
      }
    }
    this.swap(i, b);
  }

  /** A landed leaf occasionally slips off a ledge so piles stay loose. */
  private settleLeaf(x: number, i: number, b: number) {
    if (rnd() > 0.15) return;
    const dx = rnd() < 0.5 ? -1 : 1;
    if (x + dx >= 0 && x + dx < this.w && this.canEnter(LEAF, b + dx)) this.swap(i, b + dx);
  }

  private trySprout(x: number, y: number, i: number) {
    const { w, h, type } = this;
    // 8-neighbours: seed and water fall together, so the water is often only
    // diagonally adjacent (scan order always moves it one cell first).
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (type[j] === WATER) {
          this.set(j, EMPTY);
          this.set(i, PLANT);
          this.life[i] = (25 + rnd() * 35) | 0;
          return true;
        }
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- liquids

  private updateLiquid(x: number, y: number, i: number, t: number) {
    const { w, h } = this;
    switch (t) {
      case LAVA:
        if (this.lavaReact(x, y, i)) return;
        if (rnd() < 0.55) return; // viscous
        break;
      case ACID:
        if (this.acidReact(x, y, i)) return;
        break;
      case WATER:
        if (this.heatwave && y > 0 && this.type[i - w] === EMPTY && rnd() < 0.004) {
          this.set(i, STEAM);
          return;
        }
        break;
    }
    if (this.windPush(x, y, i, t, 0.25)) return;
    if (y + 1 < h) {
      const b = i + w;
      if (this.canEnter(t, b)) {
        this.swap(i, b);
        return;
      }
      const dx = rnd() < 0.5 ? -1 : 1;
      if (x + dx >= 0 && x + dx < w && this.canEnter(t, b + dx)) {
        this.swap(i, b + dx);
        return;
      }
      if (x - dx >= 0 && x - dx < w && this.canEnter(t, b - dx)) {
        this.swap(i, b - dx);
        return;
      }
    }
    let disp = t === LAVA ? 1 : t === WATER ? 5 : 3;
    if (this.quakeTimer > 0) disp += 2;
    let dx = rnd() < 0.5 ? -1 : 1;
    for (let pass = 0; pass < 2; pass++, dx = -dx) {
      let last = -1;
      for (let k = 1; k <= disp; k++) {
        const nx = x + dx * k;
        if (nx < 0 || nx >= w) break;
        const j = i + dx * k;
        if (!this.canEnter(t, j)) break;
        last = j;
      }
      if (last >= 0) {
        this.swap(i, last);
        return;
      }
    }
  }

  private lavaReact(x: number, y: number, i: number) {
    const { w, h, type } = this;
    // Check every neighbour: the lava/water steam reaction must be reliable,
    // and lava and water separate quickly (lava sinks through it).
    for (let d = 0; d < 8; d++) {
      const nx = x + DX8[d];
      const ny = y + DY8[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      const tj = type[j];
      switch (tj) {
        case WATER:
          this.set(j, STEAM);
          if (rnd() < 0.4) {
            this.set(i, STONE);
            this.shade[i] = (rnd() * 90) | 0;
            return true;
          }
          break;
        case ICE: this.set(j, WATER); break;
        case C4: this.detonate(j); break;
        case OIL: case SEED: case LEAF: case PLANT: case DRYPLANT: this.ignite(j); break;
        case WOOD: case BUILDING: if (rnd() < 0.15) this.ignite(j); break;
        case SAND: if (rnd() < 0.006) this.set(j, GLASS); break;
        case METAL: if (rnd() < 0.002) this.set(j, LAVA); break;
        case WIRE: if (rnd() < 0.02) this.set(j, EMPTY); break;
        case EMPTY:
          if (j === i - this.w && rnd() < 0.03) {
            this.set(j, FIRE);
            this.life[j] = (6 + rnd() * 12) | 0;
          }
          break;
      }
    }
    if (rnd() < 0.0005) {
      this.set(i, STONE);
      this.shade[i] = (rnd() * 90) | 0;
      return true;
    }
    return false;
  }

  private acidReact(x: number, y: number, i: number) {
    for (let n = 0; n < 3; n++) {
      const j = this.rn8(x, y);
      if (j < 0) continue;
      const p = DISSOLVE[this.type[j]];
      if (p > 0 && rnd() < p * 4) {
        this.set(j, rnd() < 0.25 ? SMOKE : EMPTY);
        if (rnd() < 0.15) {
          this.set(i, EMPTY);
          return true;
        }
      }
    }
    return false;
  }

  // ---------------------------------------------------------------- gases

  private updateGas(x: number, y: number, i: number, t: number) {
    const { w, type } = this;
    const l = --this.life[i];
    if (l <= 0) {
      if (t === STEAM && rnd() < (this.heatwave ? 0.12 : 0.45)) this.set(i, WATER);
      else this.set(i, EMPTY);
      return;
    }
    if (t === STEAM && rnd() < 0.05) {
      const j = this.rn8(x, y);
      if (j >= 0 && type[j] === ICE) {
        this.set(i, WATER);
        return;
      }
    }
    if (this.windPush(x, y, i, t, 1)) return;
    if (rnd() < 0.15) return;
    if (y > 0) {
      const dx = ((rnd() * 3) | 0) - 1;
      const nx = x + dx;
      if (nx >= 0 && nx < w) {
        const j = i - w + dx;
        const tj = type[j];
        if (tj === EMPTY) {
          this.swap(i, j);
          return;
        }
        if (dx === 0 && KIND[tj] === K_LIQUID && rnd() < 0.5) {
          this.swap(i, j); // bubble up through liquid
          return;
        }
      }
    }
    const dx = rnd() < 0.5 ? -1 : 1;
    if (x + dx >= 0 && x + dx < w && type[i + dx] === EMPTY) this.swap(i, i + dx);
  }

  // ---------------------------------------------------------------- energy

  private updateFire(x: number, y: number, i: number) {
    const { w, h, type } = this;
    const l = --this.life[i];
    if (l <= 0) {
      this.set(i, rnd() < 0.35 ? SMOKE : EMPTY);
      return;
    }
    for (let n = 0; n < 2; n++) {
      const j = this.rn8(x, y);
      if (j < 0) continue;
      const tj = type[j];
      if (tj === WATER) {
        this.set(i, rnd() < 0.5 ? SMOKE : EMPTY);
        if (rnd() < 0.5) this.set(j, STEAM);
        return;
      }
      if (tj === ICE) {
        if (rnd() < 0.08) this.set(j, WATER);
      } else if (tj === C4) {
        this.detonate(j);
      } else if (FLAMMABLE[tj] > 0) {
        // Oil is a fast-burning fuel: it catches almost instantly on contact.
        const p = FLAMMABLE[tj] * this.heatMul * (tj === OIL ? 3 : 1);
        if (rnd() < Math.min(0.9, p)) this.ignite(j);
      }
    }
    // Deterministic surface ignition: a flame always tries to light the fuel
    // directly beneath it (the random pass above often misses it).
    if (y < h - 1) {
      const b = i + w;
      if (type[b] === OIL && rnd() < 0.6) this.ignite(b);
    }
    // A flame sitting on a flammable liquid burns into it instead of
    // drifting off the surface before it can ignite the fuel.
    const overFuel =
      (x > 0 && type[i - 1] === OIL) ||
      (x < w - 1 && type[i + 1] === OIL) ||
      (y < h - 1 && type[i + w] === OIL);
    if (overFuel && rnd() < 0.85) return;
    if (this.windPush(x, y, i, FIRE, 1.2)) return;
    if (y > 0 && rnd() < 0.55) {
      const dx = ((rnd() * 3) | 0) - 1;
      const nx = x + dx;
      if (nx >= 0 && nx < w && type[i - w + dx] === EMPTY) this.swap(i, i - w + dx);
    } else if (rnd() < 0.3) {
      const dx = rnd() < 0.5 ? -1 : 1;
      if (x + dx >= 0 && x + dx < w && type[i + dx] === EMPTY) this.swap(i, i + dx);
    }
  }

  private updateSpark(x: number, y: number, i: number) {
    const { w, h, type } = this;
    if (--this.life[i] <= 0) {
      this.set(i, EMPTY);
      return;
    }
    const n = [y > 0 ? i - w : -1, y < h - 1 ? i + w : -1, x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1];
    for (const j of n) {
      if (j < 0) continue;
      const tj = type[j];
      if (CONDUCTIVE[tj]) {
        if (this.charge[j] === 0) {
          this.charge[j] = HEAD;
          this.anyCharge = true;
        }
        this.set(i, EMPTY);
        return;
      }
      if (tj === C4) this.detonate(j);
      else if (FLAMMABLE[tj] > 0 && rnd() < 0.4) this.ignite(j);
    }
    const r = rnd();
    const dy = r < 0.55 ? 1 : r < 0.8 ? 0 : -1;
    const dx = ((rnd() * 3) | 0) - 1;
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < w && ny < h) {
      const j = ny * w + nx;
      if (type[j] === EMPTY) this.swap(i, j);
    }
  }

  ignite(j: number) {
    const t = this.type[j];
    if (t === C4) {
      this.detonate(j);
    } else if (t === OIL) {
      this.set(j, FIRE);
      this.life[j] = (60 + rnd() * 80) | 0;
      // Ignition kernel: a pool catches as a small flame cluster so the fire
      // front runs along the surface instead of guttering out at the water line.
      const { w, h, type } = this;
      const x = j % w;
      const y = (j / w) | 0;
      const n = [x > 0 ? j - 1 : -1, x < w - 1 ? j + 1 : -1, y < h - 1 ? j + w : -1];
      for (const k of n) {
        if (k >= 0 && type[k] === OIL && rnd() < 0.5) {
          this.set(k, FIRE);
          this.life[k] = (50 + rnd() * 70) | 0;
        }
      }
    } else if (t === SEED || t === LEAF) {
      this.set(j, FIRE);
    } else if (BURN_TIME[t] > 0 && this.burn[j] === 0) {
      this.burn[j] = (BURN_TIME[t] * (0.6 + rnd() * 0.8)) | 0 || 1;
    }
  }

  // ---------------------------------------------------------------- static

  private updateStatic(x: number, y: number, i: number, t: number) {
    if (this.burn[i] > 0) {
      this.updateBurning(x, y, i, t);
      return;
    }
    const { type } = this;
    switch (t) {
      case PLANT: this.updatePlant(x, y, i); break;
      case DRYPLANT: {
        if (this.heatwave && rnd() < 0.00004) this.ignite(i);
        else if (rnd() < 0.01) {
          const j = this.rn8(x, y);
          if (j >= 0 && type[j] === WATER) {
            this.set(j, EMPTY);
            this.set(i, PLANT);
          }
        }
        break;
      }
      case ICE: {
        if (this.heatwave && rnd() < 0.001) {
          this.set(i, WATER);
        } else if (!this.heatwave && rnd() < 0.01) {
          const j = this.rn8(x, y);
          if (j >= 0 && type[j] === WATER && rnd() < 0.3) this.set(j, ICE);
        }
        break;
      }
      case BUILDING:
      case WINDOW: {
        // floodwater slowly erodes buildings
        if (rnd() < 0.002) {
          const j = this.rn8(x, y);
          if (j >= 0 && type[j] === WATER && rnd() < 0.25) this.set(i, t === WINDOW ? SHARD : RUBBLE);
        }
        break;
      }
      case GENERATOR: {
        if (this.frame % 40 === 0) {
          const { w, h } = this;
          const n = [y > 0 ? i - w : -1, y < h - 1 ? i + w : -1, x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1];
          for (const j of n) {
            if (j >= 0 && CONDUCTIVE[type[j]] && this.charge[j] === 0) {
              this.charge[j] = HEAD;
              this.anyCharge = true;
            }
          }
        }
        break;
      }
    }
  }

  private updateBurning(x: number, y: number, i: number, t: number) {
    const b = --this.burn[i];
    const j = this.rn8(x, y);
    if (j >= 0) {
      const tj = this.type[j];
      if (tj === WATER) {
        this.burn[i] = 0;
        if (rnd() < 0.5) this.set(j, STEAM);
        return;
      }
      if (tj === EMPTY) {
        if (rnd() < 0.3) {
          this.set(j, FIRE);
          this.life[j] = (8 + rnd() * 14) | 0;
        }
      } else if (tj === C4) {
        this.detonate(j);
      } else if (FLAMMABLE[tj] > 0 && this.burn[j] === 0 && rnd() < FLAMMABLE[tj] * this.heatMul * 1.5) {
        this.ignite(j);
      }
    }
    if (b === 0) {
      const r = rnd();
      switch (t) {
        case WOOD: this.set(i, r < 0.35 ? ASH : r < 0.6 ? SMOKE : EMPTY); break;
        case BUILDING: this.set(i, r < 0.7 ? RUBBLE : ASH); break;
        default: this.set(i, r < 0.15 ? ASH : r < 0.45 ? SMOKE : EMPTY);
      }
    }
  }

  private updatePlant(x: number, y: number, i: number) {
    const { w, h, type, life } = this;
    const e = life[i];
    if (e > 0 && rnd() < 0.1) {
      const r = rnd();
      let dx = 0;
      let dy = -1;
      if (r < 0.22) dx = -1;
      else if (r < 0.44) dx = 1;
      if (r > 0.92) dy = 0;
      const nx = x + dx;
      const ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) {
        const j = ny * w + nx;
        const tj = type[j];
        if (tj === EMPTY || tj === WATER) {
          this.set(j, PLANT);
          life[j] = e - 1;
          life[i] = rnd() < 0.12 ? (e >> 1) : 0; // occasionally keep energy to branch
        }
      }
    }
    if (rnd() < 0.03) {
      const j = this.rn8(x, y);
      if (j >= 0 && type[j] === WATER) {
        this.set(j, EMPTY);
        life[i] = Math.min(40, life[i] + 3);
      } else if (this.heatwave && rnd() < 0.08) {
        this.set(i, DRYPLANT);
      }
    }
  }

  // ---------------------------------------------------------------- electricity

  private electricPass() {
    const { type, w, size } = this;
    const cur = this.charge;
    const next = this.chargeNext;
    let any = false;
    for (let i = 0; i < size; i++) {
      const t = type[i];
      if (!CONDUCTIVE[t]) {
        next[i] = 0;
        continue;
      }
      const c = cur[i];
      if (c > 0) {
        next[i] = c - 1;
        any = true;
        if (c === HEAD && rnd() < 0.15) this.chargeEffect(i, t);
        continue;
      }
      const x = i % w;
      const hit =
        (i >= w && cur[i - w] === HEAD) ||
        (i < size - w && cur[i + w] === HEAD) ||
        (x > 0 && cur[i - 1] === HEAD) ||
        (x < w - 1 && cur[i + 1] === HEAD);
      if (hit && (t !== WATER || rnd() < 0.85)) {
        next[i] = HEAD;
        any = true;
      } else next[i] = 0;
    }
    this.charge = next;
    this.chargeNext = cur;
    this.anyCharge = any;
  }

  private chargeEffect(i: number, t: number) {
    const { w, h, type } = this;
    const x = i % w;
    const y = (i / w) | 0;
    const j = this.rn8(x, y);
    if (j < 0) return;
    const tj = type[j];
    if (tj === C4) this.detonate(j);
    else if ((tj === OIL || tj === DRYPLANT) && rnd() < 0.3) this.ignite(j);
    else if (tj === EMPTY) {
      if (t === WATER) {
        if (j === i - w && rnd() < 0.05) this.set(j, SPARK);
      } else if (t === WIRE) {
        // live, dangling wire ends throw sparks
        let links = 0;
        const n = [y > 0 ? i - w : -1, y < h - 1 ? i + w : -1, x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1];
        for (const k of n) {
          if (k < 0) continue;
          const tk = type[k];
          if (CONDUCTIVE[tk] || tk === GENERATOR || tk === WOOD || tk === BUILDING || tk === WINDOW) links++;
        }
        if (links <= 1 && rnd() < 0.5) this.set(j, SPARK);
      }
    }
  }

  // ---------------------------------------------------------------- rigid bodies

  private rigidPass() {
    if (this.rigidCount === 0) return;
    const { w, h, size, type, comp, stack, fall } = this;
    comp.fill(0);
    let n = 0;
    for (let i = 0; i < size; i++) {
      if (comp[i] !== 0 || !RIGID[type[i]]) continue;
      n++;
      let sp = 0;
      stack[sp++] = i;
      comp[i] = n;
      while (sp > 0) {
        const c = stack[--sp];
        const x = c % w;
        let j: number;
        if (x > 0 && comp[(j = c - 1)] === 0 && RIGID[type[j]]) { comp[j] = n; stack[sp++] = j; }
        if (x < w - 1 && comp[(j = c + 1)] === 0 && RIGID[type[j]]) { comp[j] = n; stack[sp++] = j; }
        if (c >= w && comp[(j = c - w)] === 0 && RIGID[type[j]]) { comp[j] = n; stack[sp++] = j; }
        if (c < size - w && comp[(j = c + w)] === 0 && RIGID[type[j]]) { comp[j] = n; stack[sp++] = j; }
      }
    }
    if (n === 0) return;
    if (this.supported.length < n + 1) this.supported = new Uint8Array((n + 1) * 2);
    const sup = this.supported;
    sup.fill(0, 0, n + 1);

    // What is each body resting on?
    const { edgeFrom, edgeTo } = this;
    let ne = 0;
    const lastRow = size - w;
    for (let i = 0; i < lastRow; i++) {
      const c = comp[i];
      if (c === 0) continue;
      const tj = type[i + w];
      if (tj === WALL || KIND[tj] === K_POWDER || tj === PLANT || tj === DRYPLANT) sup[c] = 1;
      else if (RIGID[tj]) {
        const d = comp[i + w];
        if (d !== c) {
          edgeFrom[ne] = d;
          edgeTo[ne] = c;
          ne++;
        }
      } else if (KIND[tj] === K_LIQUID && tj !== LAVA && FLOATS[type[i]]) sup[c] = 1;
    }
    for (let i = lastRow; i < size; i++) if (comp[i]) sup[comp[i]] = 1;

    // Propagate support up through stacks of bodies.
    if (ne > 0) {
      const start = new Int32Array(n + 2);
      for (let e = 0; e < ne; e++) start[edgeFrom[e] + 1]++;
      for (let c = 1; c <= n + 1; c++) start[c] += start[c - 1];
      const fill = start.slice();
      const adj = new Int32Array(ne);
      for (let e = 0; e < ne; e++) adj[fill[edgeFrom[e]]++] = edgeTo[e];
      const queue = new Int32Array(n + 1);
      let qh = 0;
      let qt = 0;
      for (let c = 1; c <= n; c++) if (sup[c]) queue[qt++] = c;
      while (qh < qt) {
        const c = queue[qh++];
        for (let k = start[c]; k < start[c + 1]; k++) {
          const d = adj[k];
          if (!sup[d]) {
            sup[d] = 1;
            queue[qt++] = d;
          }
        }
      }
    }

    // Landings: fragile bodies shatter after long falls.
    let anyFall = false;
    for (let i = 0; i < size; i++) {
      const c = comp[i];
      if (c === 0) continue;
      if (!sup[c]) {
        anyFall = true;
        continue;
      }
      const f = fall[i];
      if (f === 0) continue;
      fall[i] = 0;
      if (f > 12 && FRAGILE[type[i]]) {
        const t = type[i];
        if (t === BUILDING) {
          if (rnd() < 0.6) this.set(i, RUBBLE);
        } else this.set(i, SHARD);
      }
    }
    if (!anyFall) return;

    // Move unsupported bodies down one cell, bottom-up.
    for (let y = h - 2; y >= 0; y--) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i = row + x;
        const c = comp[i];
        if (c === 0 || sup[c] || !RIGID[type[i]]) continue;
        const j = i + w;
        if (RIGID[type[j]]) continue;
        this.swap(i, j);
        if (fall[j] < 255) fall[j]++;
      }
    }
  }

  // ---------------------------------------------------------------- explosions

  detonate(j: number) {
    if (this.type[j] !== C4 || this.life[j] === 1) return;
    this.life[j] = 1;
    this.pending.push({ i: j, t: 2 + ((rnd() * 3) | 0) });
  }

  private processPending() {
    if (this.pending.length === 0) return;
    const keep: Pending[] = [];
    const due: number[] = [];
    for (const p of this.pending) {
      if (--p.t <= 0) due.push(p.i);
      else keep.push(p);
    }
    this.pending = keep;
    for (const i of due) {
      if (this.type[i] === C4) {
        this.explodeCluster(i);
        continue;
      }
      // C4 is a rigid body: it can fall while the fuse is burning, leaving the
      // recorded cell empty. Look for the (armed) charge nearby instead.
      const { w, h } = this;
      const x0 = i % w;
      const y0 = (i / w) | 0;
      let found = -1;
      for (let r = 1; found < 0 && r <= 5; r++) {
        for (let dy = -r; dy <= r && found < 0; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            const x = x0 + dx;
            const y = y0 + dy;
            if (x < 0 || y < 0 || x >= w || y >= h) continue;
            const j = y * w + x;
            if (this.type[j] === C4) {
              found = j;
              break;
            }
          }
        }
      }
      if (found >= 0) this.explodeCluster(found);
    }
  }

  private explodeCluster(i0: number) {
    const { w, size, type, stack } = this;
    let sp = 0;
    let n = 0;
    let sx = 0;
    let sy = 0;
    stack[sp++] = i0;
    type[i0] = EMPTY;
    while (sp > 0) {
      const c = stack[--sp];
      const x = c % w;
      const y = (c / w) | 0;
      n++;
      sx += x;
      sy += y;
      for (let d = 0; d < 8; d++) {
        const nx = x + DX8[d];
        const ny = y + DY8[d];
        if (nx < 0 || nx >= w || ny < 0) continue;
        const j = ny * w + nx;
        if (j >= size || type[j] !== C4) continue;
        type[j] = EMPTY;
        stack[sp++] = j;
      }
    }
    this.explode(sx / n, sy / n, Math.min(48, 5 + Math.sqrt(n) * 1.7));
  }

  explode(cx: number, cy: number, r: number) {
    const { w, h, type } = this;
    this.shake = Math.max(this.shake, Math.min(16, 4 + r * 0.4));
    const shock = r * 1.6;
    const outer = r * 2.2;
    const x0 = Math.max(0, Math.floor(cx - outer));
    const x1 = Math.min(w - 1, Math.ceil(cx + outer));
    const y0 = Math.max(0, Math.floor(cy - outer));
    const y1 = Math.min(h - 1, Math.ceil(cy + outer));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > outer) continue;
        const i = y * w + x;
        const nd = d || 1;
        // blast wind
        const push = 3 * (1 - d / outer);
        this.windX[i] += (dx / nd) * push;
        this.windY[i] += (dy / nd) * push;
        const t = type[i];
        if (t === WALL || d > shock) continue;
        if (t === C4) {
          this.detonate(i);
          continue;
        }
        if (d <= r) {
          if (t !== EMPTY && KIND[t] !== K_GAS && KIND[t] !== K_ENERGY && rnd() < 0.12) {
            const pt = debrisType(t);
            if (pt >= 0) {
              const sp = (1 - d / r) * 4 + 1 + rnd() * 2;
              this.launch(x, y, (dx / nd) * sp, (dy / nd) * sp - 1.5, pt);
            }
          }
          const f = d / r;
          if (rnd() < 0.75 - f * 0.45) {
            this.set(i, FIRE);
            this.life[i] = (15 + rnd() * 40) | 0;
          } else this.set(i, rnd() < 0.5 ? SMOKE : EMPTY);
        } else {
          if (t === BUILDING || (t === STONE && rnd() < 0.4) || (t === ROAD && rnd() < 0.3)) this.set(i, RUBBLE);
          else if (t === GLASS || t === WINDOW || t === ICE) this.set(i, SHARD);
          else if (t === WIRE && rnd() < 0.5) this.set(i, EMPTY);
          else if (FLAMMABLE[t] > 0 && rnd() < 0.5) this.ignite(i);
        }
      }
    }
    this.windFieldTimer = Math.max(this.windFieldTimer, 200);
  }

  launch(x: number, y: number, vx: number, vy: number, t: number) {
    if (this.projectiles.length >= MAX_PROJECTILES) return;
    this.projectiles.push({ x: x + 0.5, y: y + 0.5, vx, vy, t });
  }

  private updateProjectiles() {
    const P = this.projectiles;
    if (P.length === 0) return;
    const { w, h, type } = this;
    let k = 0;
    for (let n = 0; n < P.length; n++) {
      const p = P[n];
      p.vy += 0.15;
      const ci = Math.floor(p.y) * w + Math.floor(p.x);
      const wx = this.gWind + (ci >= 0 && ci < this.size ? this.windX[ci] : 0);
      p.vx = (p.vx + wx * 0.04) * 0.995;
      const steps = Math.max(1, Math.ceil(Math.max(Math.abs(p.vx), Math.abs(p.vy))));
      let alive = true;
      for (let s = 0; s < steps; s++) {
        const nx = p.x + p.vx / steps;
        const ny = p.y + p.vy / steps;
        const cx = Math.floor(nx);
        const cy = Math.floor(ny);
        if (cx < 0 || cx >= w) {
          alive = false;
          break;
        }
        if (cy >= h) {
          this.deposit(Math.floor(p.x), Math.min(h - 1, Math.floor(p.y)), p.t);
          alive = false;
          break;
        }
        if (cy >= 0) {
          const j = cy * w + cx;
          const tj = type[j];
          if (tj !== EMPTY && KIND[tj] !== K_GAS && tj !== FIRE) {
            if (p.t === LAVA || p.t === FIRE) {
              if (tj === WATER) {
                this.set(j, STEAM);
                alive = false;
                break;
              }
              if (FLAMMABLE[tj] > 0 || tj === C4) this.ignite(j);
            }
            this.deposit(Math.floor(p.x), Math.floor(p.y), p.t);
            alive = false;
            break;
          }
        }
        p.x = nx;
        p.y = ny;
      }
      if (alive) P[k++] = p;
    }
    P.length = k;
  }

  private deposit(x: number, y: number, t: number) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = y * this.w + x;
    const ti = this.type[i];
    if (ti === EMPTY || KIND[ti] === K_GAS || ti === FIRE) this.set(i, t);
  }

  // ---------------------------------------------------------------- environment

  private environment() {
    const { w, type } = this;
    if (this.rain) {
      const n = 3;
      for (let k = 0; k < n; k++) {
        const x = (rnd() * w) | 0;
        if (type[x] === EMPTY) this.set(x, WATER);
      }
    }
    if (this.quakeTimer > 0) {
      this.quakeTimer--;
      this.quakeStep();
    }
    if (this.floodTimer > 0) {
      this.floodTimer--;
      this.floodStep();
    }
    if (this.eruptTimer > 0) {
      this.eruptTimer--;
      this.eruptStep();
    }
    if (this.quakeTimer > 0) this.shake = Math.max(this.shake, 5);
    else {
      this.shake *= 0.85;
      if (this.shake < 0.3) this.shake = 0;
    }
  }

  triggerQuake() {
    this.quakeTimer = QUAKE_DURATION;
  }

  private quakeStep() {
    const { w, h, size, type } = this;
    for (let s = 0; s < 500; s++) {
      const i = (rnd() * size) | 0;
      const r = rnd();
      switch (type[i]) {
        case STONE: if (r < 0.12) this.set(i, RUBBLE); break;
        case BUILDING: if (r < 0.3) this.set(i, RUBBLE); break;
        case WINDOW: case GLASS: if (r < 0.5) this.set(i, SHARD); break;
        case ICE: if (r < 0.3) this.set(i, SHARD); break;
        case WIRE: if (r < 0.1) this.set(i, EMPTY); break;
        case WOOD: if (r < 0.04) this.set(i, EMPTY); break;
        case ROAD: if (r < 0.05) this.set(i, RUBBLE); break;
      }
    }
    // fault lines tear upward through the terrain
    if (this.frame % 20 === 0) {
      let x = (rnd() * w) | 0;
      let y = h - 1;
      const len = 20 + rnd() * 50;
      for (let k = 0; k < len && y >= 0; k++) {
        const i = y * w + x;
        const t = type[i];
        if (RIGID[t] && t !== METAL) this.set(i, rnd() < 0.5 ? EMPTY : RUBBLE);
        x = Math.max(0, Math.min(w - 1, x + ((rnd() * 3) | 0) - 1));
        y--;
      }
    }
  }

  triggerFlood() {
    this.floodTimer = FLOOD_DURATION;
  }

  private floodStep() {
    const { w, h, type } = this;
    const prog = 1 - this.floodTimer / FLOOD_DURATION;
    const level = 4 + ((h * 0.6 * Math.min(1, prog * 1.6)) | 0);
    for (let side = 0; side < 2; side++) {
      for (let k = 0; k < 22; k++) {
        const off = (rnd() * 3) | 0;
        const x = side ? w - 1 - off : off;
        const y = h - 1 - ((rnd() * level) | 0);
        const i = y * w + x;
        const t = type[i];
        if (t === EMPTY || KIND[t] === K_GAS) this.set(i, WATER);
      }
      if (rnd() < 0.6) {
        const y = h - 2 - rnd() * level * 0.8;
        this.launch(side ? w - 2 : 1, y, (side ? -1 : 1) * (2 + rnd() * 3), -rnd() * 1.5, WATER);
      }
    }
  }

  triggerEruption() {
    if (!this.vent) this.buildVolcano();
    this.eruptTimer = ERUPT_DURATION;
  }

  private buildVolcano() {
    const { w, h, type } = this;
    const cxv = (w * (0.25 + rnd() * 0.5)) | 0;
    let ground = h;
    for (let y = 0; y < h; y++) {
      const t = type[y * w + cxv];
      if (t !== EMPTY && KIND[t] !== K_GAS && KIND[t] !== K_LIQUID && KIND[t] !== K_ENERGY) {
        ground = y;
        break;
      }
    }
    const height = Math.min(48, ground - 20);
    if (height < 8) {
      this.vent = { x: cxv, y: Math.max(4, ground - 1) };
      return;
    }
    const base = ground - 1;
    const top = base - height;
    const half = Math.round(height * 1.4);
    for (let x = cxv - half; x <= cxv + half; x++) {
      if (x < 0 || x >= w) continue;
      const ch = height - Math.abs(x - cxv) / 1.4;
      const yTop = Math.round(base - ch);
      for (let y = yTop; y < h; y++) {
        const i = y * w + x;
        const t = type[i];
        if (!(t === EMPTY || KIND[t] === K_GAS || KIND[t] === K_LIQUID || KIND[t] === K_ENERGY)) break;
        const crater = Math.abs(x - cxv) <= 1 && y < top + 10;
        this.set(i, crater ? LAVA : STONE);
        if (!crater) this.shade[i] = (rnd() * 110) | 0;
      }
    }
    this.vent = { x: cxv, y: top };
  }

  private eruptStep() {
    const v = this.vent;
    if (!v) return;
    const { w } = this;
    const elapsed = ERUPT_DURATION - this.eruptTimer;
    const intensity = Math.min(1, elapsed / 60, this.eruptTimer / 120);
    // keep the throat open
    for (let dy = 1; dy <= 3; dy++) {
      const y = v.y - dy;
      if (y < 0) break;
      for (let dx = -1; dx <= 1; dx++) {
        const x = v.x + dx;
        if (x < 0 || x >= w) continue;
        const i = y * w + x;
        const t = this.type[i];
        if (t !== EMPTY && t !== WALL && t !== LAVA && KIND[t] !== K_GAS) this.set(i, EMPTY);
      }
    }
    const n = (1 + rnd() * 5 * intensity) | 0;
    for (let k = 0; k < n; k++) {
      this.launch(
        v.x + rnd() * 3 - 1.5,
        v.y - 2,
        (rnd() - 0.5) * 3.4,
        -(2.2 + rnd() * 3.8) * intensity - 0.5,
        rnd() < 0.85 ? LAVA : RUBBLE,
      );
    }
    if (rnd() < 0.5) {
      const x = v.x + ((rnd() * 7) | 0) - 3;
      const y = v.y - 4 - ((rnd() * 3) | 0);
      if (x >= 0 && x < w && y >= 0 && this.type[y * w + x] === EMPTY) this.set(y * w + x, SMOKE);
    }
    this.shake = Math.max(this.shake, 2 * intensity);
  }

  private decayWind() {
    if (this.windFieldTimer <= 0) return;
    this.windFieldTimer--;
    const { windX, windY, size } = this;
    if (this.windFieldTimer === 0) {
      windX.fill(0);
      windY.fill(0);
      return;
    }
    for (let i = 0; i < size; i++) {
      windX[i] *= 0.965;
      windY[i] *= 0.965;
    }
  }

  // ---------------------------------------------------------------- tools

  paint(cx: number, cy: number, r: number, t: number) {
    const { w, h, type } = this;
    const k = KIND[t];
    let p = k === K_STATIC ? 1 : t === SPARK ? 0.12 : t === FIRE ? 0.5 : 0.4;
    if (r <= 1) p = 1;
    const r2 = r * r;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy >= r2) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        if (rnd() > p) continue;
        const i = y * w + x;
        const tt = type[i];
        if (t === FIRE && (FLAMMABLE[tt] > 0 || tt === C4)) {
          this.ignite(i);
          continue;
        }
        if (t === SPARK && CONDUCTIVE[tt]) {
          this.charge[i] = HEAD;
          this.anyCharge = true;
          continue;
        }
        const free = tt === EMPTY || KIND[tt] === K_GAS || tt === FIRE;
        if (free || (k === K_STATIC && KIND[tt] === K_LIQUID)) this.set(i, t);
      }
    }
  }

  blow(cx: number, cy: number, r: number, dx: number, dy: number) {
    const { w, h } = this;
    const rr = r + 3;
    for (let oy = -rr; oy <= rr; oy++) {
      for (let ox = -rr; ox <= rr; ox++) {
        if (ox * ox + oy * oy > rr * rr) continue;
        const x = cx + ox;
        const y = cy + oy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = y * w + x;
        this.windX[i] = dx * 2.2;
        this.windY[i] = dy * 2.2;
      }
    }
    this.windFieldTimer = Math.max(this.windFieldTimer, 180);
  }

  erase(cx: number, cy: number, r: number, filter: number) {
    const { w, h, type } = this;
    const r2 = Math.max(1, r * r);
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy >= r2) continue;
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= w || y >= h) continue;
        const i = y * w + x;
        if (type[i] !== EMPTY && (filter < 0 || type[i] === filter)) this.set(i, EMPTY);
      }
    }
  }

  /** Erase the whole connected structure under (x, y). */
  eraseStructure(x: number, y: number) {
    const { w, h, size, type, stack } = this;
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    const i0 = y * w + x;
    const t0 = type[i0];
    if (t0 === EMPTY) return;
    const rigid = RIGID[t0] === 1;
    const match = (t: number) => (rigid ? RIGID[t] === 1 : t === t0);
    let sp = 0;
    stack[sp++] = i0;
    this.set(i0, EMPTY);
    let count = 0;
    while (sp > 0 && count < 40000) {
      const c = stack[--sp];
      count++;
      const cxp = c % w;
      const nb = [cxp > 0 ? c - 1 : -1, cxp < w - 1 ? c + 1 : -1, c - w, c + w];
      for (const j of nb) {
        if (j < 0 || j >= size || !match(type[j])) continue;
        this.set(j, EMPTY);
        stack[sp++] = j;
      }
    }
  }

  setVent(x: number, y: number) {
    this.vent = { x: Math.max(1, Math.min(this.w - 2, x)), y: Math.max(4, Math.min(this.h - 1, y)) };
  }
}

function debrisType(t: number) {
  switch (t) {
    case BUILDING: case STONE: case ROAD: case RUBBLE: return RUBBLE;
    case GLASS: case WINDOW: case ICE: case SHARD: return SHARD;
    case WATER: case OIL: case ACID: case LAVA: case SAND: case METAL: return t;
    case WOOD: return FIRE;
    case PLANT: case DRYPLANT: case LEAF: case ASH: return ASH;
    default: return -1;
  }
}

