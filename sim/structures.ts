import { World } from './world';
import { BUILDING, WINDOW, ROAD, WIRE, WOOD, METAL, OIL, PLANT, GENERATOR, EMPTY, KIND, K_GAS, K_LIQUID } from './elements';

const rnd = Math.random;

/** Stamp one building whose bottom-centre sits at (cx, baseY). */
export function stampBuilding(world: World, cx: number, baseY: number, bw?: number, bh?: number) {
  const width = bw ?? 10 + ((rnd() * 12) | 0);
  const height = bh ?? 16 + ((rnd() * 34) | 0);
  const x0 = Math.round(cx - width / 2);
  const tint = 40 + ((rnd() * 180) | 0);
  const litBias = 0.35 + rnd() * 0.45;
  for (let ly = 0; ly < height; ly++) {
    const y = baseY - ly;
    if (y < 0) break;
    for (let lx = 0; lx < width; lx++) {
      const x = x0 + lx;
      const isWindow =
        lx >= 2 && lx <= width - 3 && ly >= 3 && ly <= height - 3 && (lx - 2) % 4 < 2 && (ly - 3) % 4 < 2;
      if (isWindow) world.place(x, y, WINDOW, rnd() < litBias ? 200 : 40);
      else world.place(x, y, BUILDING, Math.max(0, Math.min(255, tint + ((rnd() * 24) | 0) - 12)));
    }
  }
  // rooftop antenna
  if (rnd() < 0.4) {
    const ax = x0 + 2 + ((rnd() * (width - 4)) | 0);
    const ah = 3 + ((rnd() * 5) | 0);
    for (let k = 1; k <= ah; k++) world.place(ax, baseY - height + 1 - k, METAL);
  }
  return { x0, width, height };
}

/** Draw a 4-connected line (so electricity can flow along it) with an optional sag. */
function drawWire(world: World, x0: number, y0: number, x1: number, y1: number, sag: number) {
  const len = Math.max(1, Math.abs(x1 - x0));
  const dir = x1 >= x0 ? 1 : -1;
  let prevY = y0;
  for (let k = 0; k <= len; k++) {
    const t = k / len;
    const x = x0 + k * dir;
    const y = Math.round(y0 + (y1 - y0) * t + sag * 4 * t * (1 - t));
    const step = y >= prevY ? 1 : -1;
    for (let yy = prevY; yy !== y; yy += step) world.place(x, yy, WIRE);
    world.place(x, y, WIRE);
    prevY = y;
  }
}

function placeIfFree(world: World, x: number, y: number, t: number) {
  if (x < 0 || y < 0 || x >= world.w || y >= world.h) return;
  const c = world.type[y * world.w + x];
  if (c === EMPTY || KIND[c] === K_GAS || KIND[c] === K_LIQUID) world.place(x, y, t);
}

/** Procedurally generate a city block along the bottom of the map. */
export function generateCity(world: World) {
  const { w, h } = world;
  const ground = h - 4; // first row above the road
  // road with lane markings
  for (let y = h - 3; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dash = y === h - 2 && x % 10 < 5;
      world.place(x, y, ROAD, dash ? 255 : (rnd() * 200) | 0);
    }
  }
  // power plant
  let x = 3 + ((rnd() * 4) | 0);
  for (let gy = 0; gy < 5; gy++) for (let gx = 0; gx < 5; gx++) world.place(x + gx, ground - gy, GENERATOR);
  const poles: { x: number; top: number }[] = [{ x: x + 2, top: ground - 5 }];
  x += 8;

  const tankAt = 1 + ((rnd() * 4) | 0);
  let index = 0;
  while (x < w - 12) {
    if (index === tankAt) {
      // fuel depot: a metal tank full of oil
      const tw = 11;
      const th = 8;
      for (let ly = 0; ly < th; ly++) {
        for (let lx = 0; lx < tw; lx++) {
          const edge = lx === 0 || lx === tw - 1 || ly === 0 || ly === th - 1;
          world.place(x + lx, ground - ly, edge ? METAL : OIL);
        }
      }
      x += tw;
    } else {
      const bw = 10 + ((rnd() * 13) | 0);
      if (x + bw > w - 3) break;
      const bh = 16 + ((rnd() * Math.min(70, h * 0.42)) | 0);
      stampBuilding(world, x + bw / 2, ground, bw, bh);
      x += bw;
    }
    index++;
    const gap = 4 + ((rnd() * 8) | 0);
    if (gap >= 6 && x + gap < w - 2) {
      const px = x + (gap >> 1);
      const ph = 22 + ((rnd() * 4) | 0);
      for (let k = 0; k < ph; k++) world.place(px, ground - k, WOOD, 90);
      world.place(px - 1, ground - ph + 2, WOOD, 90);
      world.place(px + 1, ground - ph + 2, WOOD, 90);
      poles.push({ x: px, top: ground - ph });
    } else if (gap >= 4 && rnd() < 0.5) {
      // street tree
      const tx = x + (gap >> 1);
      for (let k = 0; k < 4; k++) placeIfFree(world, tx, ground - k, WOOD);
      for (let dy = -3; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++)
          if (dx * dx + dy * dy <= 6) placeIfFree(world, tx + dx, ground - 6 + dy, PLANT);
    }
    x += gap;
  }
  // electrical grid strung between poles
  for (let k = 0; k + 1 < poles.length; k++) {
    const a = poles[k];
    const b = poles[k + 1];
    drawWire(world, a.x, a.top, b.x, b.top, Math.min(6, Math.abs(b.x - a.x) * 0.08));
  }
}
