import { World } from './world';
import {
  EMPTY, FIRE, LAVA, SPARK, STEAM, SMOKE, WINDOW, ROAD, GENERATOR, PALETTE, SHADES, BG, BG_COLOR, rgba,
} from './elements';

const GLOW = 4; // glow buffer downsample factor

function gradient(stops: [number, number, number, number][], n: number) {
  const out = new Uint32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const [t0, r0, g0, b0] = stops[k];
    const [t1, r1, g1, b1] = stops[k + 1];
    const f = Math.min(1, Math.max(0, (t - t0) / (t1 - t0 || 1)));
    out[i] = rgba(r0 + (r1 - r0) * f, g0 + (g1 - g0) * f, b0 + (b1 - b0) * f);
  }
  return out;
}

const FIRE_TABLE = gradient(
  [
    [0, 90, 10, 10],
    [0.25, 200, 40, 10],
    [0.55, 255, 120, 20],
    [0.8, 255, 200, 60],
    [1, 255, 250, 200],
  ],
  64,
);
const LAVA_TABLE = gradient(
  [
    [0, 170, 30, 5],
    [0.5, 255, 90, 10],
    [0.8, 255, 160, 30],
    [1, 255, 220, 90],
  ],
  64,
);
const SIN = new Float32Array(64).map((_, i) => 0.5 + 0.5 * Math.sin((i / 64) * Math.PI * 2));

export interface Overlay {
  brushX: number;
  brushY: number;
  brushR: number;
  showBrush: boolean;
  brushColor: string;
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private off: HTMLCanvasElement;
  private offCtx: CanvasRenderingContext2D;
  private img: ImageData;
  private buf: Uint32Array;
  private glow: HTMLCanvasElement;
  private glowCtx: CanvasRenderingContext2D;
  private glowImg: ImageData;
  private glowBuf: Uint32Array;
  private gr: Float32Array;
  private gg: Float32Array;
  private gb: Float32Array;
  private gw: number;
  private gh: number;

  constructor(private canvas: HTMLCanvasElement, private w: number, private h: number) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.off = document.createElement('canvas');
    this.off.width = w;
    this.off.height = h;
    this.offCtx = this.off.getContext('2d')!;
    this.img = this.offCtx.createImageData(w, h);
    this.buf = new Uint32Array(this.img.data.buffer);
    this.gw = Math.ceil(w / GLOW);
    this.gh = Math.ceil(h / GLOW);
    this.glow = document.createElement('canvas');
    this.glow.width = this.gw;
    this.glow.height = this.gh;
    this.glowCtx = this.glow.getContext('2d')!;
    this.glowImg = this.glowCtx.createImageData(this.gw, this.gh);
    this.glowBuf = new Uint32Array(this.glowImg.data.buffer);
    const gn = this.gw * this.gh;
    this.gr = new Float32Array(gn);
    this.gg = new Float32Array(gn);
    this.gb = new Float32Array(gn);
  }

  /** Draws the world; returns the number of occupied cells. */
  render(world: World, ov: Overlay): number {
    const { w, h, buf, gr, gg, gb, gw } = this;
    const { type, life, shade, burn, charge, windX, windY } = world;
    const frame = world.frame;
    const windActive = world.windFieldTimer > 0;
    gr.fill(0);
    gg.fill(0);
    gb.fill(0);
    let count = 0;
    let i = 0;
    for (let y = 0; y < h; y++) {
      const grow = (y >> 2) * gw;
      for (let x = 0; x < w; x++, i++) {
        const t = type[i];
        if (t === EMPTY) {
          let c = BG_COLOR;
          if (windActive) {
            const m = Math.abs(windX[i]) + Math.abs(windY[i]);
            if (m > 0.25) {
              const k = Math.min(1, m / 4) * (0.6 + 0.4 * SIN[(x * 3 + y * 5 + frame * 4) & 63]);
              c = rgba(BG[0] + 20 * k, BG[1] + 60 * k, BG[2] + 80 * k);
            }
          }
          buf[i] = c;
          continue;
        }
        count++;
        let c: number;
        let emit = 0;
        switch (t) {
          case FIRE: {
            const l = Math.min(50, life[i]);
            const idx = Math.max(0, Math.min(63, ((l * 63) / 50 + ((shade[i] + frame) & 7) - 3) | 0));
            c = FIRE_TABLE[idx];
            emit = 1;
            break;
          }
          case LAVA: {
            c = LAVA_TABLE[(SIN[((shade[i] >> 2) + frame + x) & 63] * 63) | 0];
            emit = 0.7;
            break;
          }
          case SPARK:
            c = (frame + i) & 1 ? rgba(255, 255, 230) : rgba(255, 230, 120);
            emit = 1.4;
            break;
          case STEAM:
          case SMOKE: {
            const a = Math.min(1, life[i] / (t === STEAM ? 120 : 80)) * (t === STEAM ? 0.7 : 0.85);
            const base = PALETTE[t * SHADES + (shade[i] >> 3)];
            const r = base & 255;
            const g = (base >> 8) & 255;
            const b = (base >> 16) & 255;
            c = rgba(BG[0] + (r - BG[0]) * a, BG[1] + (g - BG[1]) * a, BG[2] + (b - BG[2]) * a);
            break;
          }
          case WINDOW:
            if (shade[i] > 128) {
              c = rgba(255, 210, 110);
              emit = 0.12;
            } else c = rgba(30, 48, 74);
            break;
          case ROAD:
            c = shade[i] === 255 ? rgba(220, 180, 60) : PALETTE[t * SHADES + (shade[i] >> 3)];
            break;
          case GENERATOR: {
            const on = frame % 40 < 6;
            c = on ? rgba(80, 255, 150) : (x + y) & 1 ? rgba(44, 60, 52) : rgba(36, 50, 44);
            if (on) emit = 0.8;
            break;
          }
          default:
            c = PALETTE[t * SHADES + (shade[i] >> 3)];
        }
        if (burn[i] > 0) {
          const f = 0.45 + 0.35 * SIN[(frame * 5 + i * 7) & 63];
          const r = c & 255;
          const g = (c >> 8) & 255;
          const b = (c >> 16) & 255;
          c = rgba(r + (255 - r) * f, g + (110 - g) * f, b + (20 - b) * f);
          emit = Math.max(emit, 0.6);
        }
        const ch = charge[i];
        if (ch > 0) {
          const f = ch / 3;
          const r = c & 255;
          const g = (c >> 8) & 255;
          const b = (c >> 16) & 255;
          c = rgba(r + (140 - r) * f, g + (250 - g) * f, b + (255 - b) * f);
          emit = Math.max(emit, 0.9 * f);
        }
        buf[i] = c;
        if (emit > 0) {
          const gi = grow + (x >> 2);
          gr[gi] += (c & 255) * emit;
          gg[gi] += ((c >> 8) & 255) * emit;
          gb[gi] += ((c >> 16) & 255) * emit;
        }
      }
    }

    // ballistic particles
    for (const p of world.projectiles) {
      const x = Math.floor(p.x);
      const y = Math.floor(p.y);
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const pi = y * w + x;
      let c = PALETTE[p.t * SHADES + 16];
      if (p.t === LAVA) c = LAVA_TABLE[50];
      else if (p.t === FIRE) c = FIRE_TABLE[55];
      buf[pi] = c;
      if (p.t === LAVA || p.t === FIRE) {
        const gi = (y >> 2) * gw + (x >> 2);
        gr[gi] += c & 255;
        gg[gi] += (c >> 8) & 255;
        gb[gi] += (c >> 16) & 255;
      }
    }

    const gn = gr.length;
    const norm = 1 / (GLOW * GLOW * 0.55);
    for (let k = 0; k < gn; k++) {
      this.glowBuf[k] = rgba(gr[k] * norm, gg[k] * norm, gb[k] * norm);
    }

    this.offCtx.putImageData(this.img, 0, 0);
    this.glowCtx.putImageData(this.glowImg, 0, 0);

    const { ctx, canvas } = this;
    const cw = canvas.width;
    const chh = canvas.height;
    const sx = cw / w;
    const sy = chh / h;
    ctx.save();
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, cw, chh);
    if (world.shake > 0) {
      const s = world.shake * sx * 0.6;
      ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.off, 0, 0, cw, chh);
    ctx.globalCompositeOperation = 'lighter';
    ctx.imageSmoothingEnabled = true;
    ctx.globalAlpha = 0.7;
    ctx.drawImage(this.glow, 0, 0, cw, chh);
    const bloom = GLOW * sx * 2;
    ctx.globalAlpha = 0.45;
    ctx.drawImage(this.glow, -bloom, -bloom, cw + bloom * 2, chh + bloom * 2);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';

    if (world.heatwave) {
      const g = ctx.createLinearGradient(0, 0, 0, chh);
      g.addColorStop(0, 'rgba(255,120,40,0.10)');
      g.addColorStop(1, 'rgba(255,60,20,0.03)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, cw, chh);
    }
    if (world.rain) {
      ctx.fillStyle = 'rgba(80,120,200,0.05)';
      ctx.fillRect(0, 0, cw, chh);
    }

    if (world.vent) {
      const vx = (world.vent.x + 0.5) * sx;
      const vy = world.vent.y * sy;
      const pulse = world.eruptTimer > 0 ? 1 : 0.5 + 0.5 * Math.sin(frame * 0.1);
      ctx.strokeStyle = `rgba(255,90,40,${0.4 + 0.5 * pulse})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(vx, vy - 14);
      ctx.lineTo(vx - 8, vy - 28);
      ctx.lineTo(vx + 8, vy - 28);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();

    if (ov.showBrush) {
      ctx.strokeStyle = ov.brushColor;
      ctx.lineWidth = 1.5;
      ctx.shadowColor = ov.brushColor;
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.arc((ov.brushX + 0.5) * sx, (ov.brushY + 0.5) * sy, Math.max(ov.brushR - 0.5, 0.5) * sx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    return count;
  }
}
