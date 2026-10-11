import { World } from './world';
import { EMPTY, WATER, OIL, FIRE, SEED, PLANT, C4, SPARK } from './elements';

function dump(w: World, x0: number, y0: number, x1: number, y1: number) {
  const M: Record<number, string> = { 0: '.', 7: 'W', 8: 'o', 15: 'F', 14: 's', 13: 'P', 16: 'C', 17: '*' };
  for (let y = y0; y <= y1; y++) {
    let line = '';
    for (let x = x0; x <= x1; x++) line += M[w.type[y * w.w + x]] ?? '?';
    console.log(line);
  }
}

// --- oil debug
{
  const w2 = new World(40, 40);
  for (let x = 5; x < 35; x++) {
    w2.set(30 * 40 + x, WATER);
    w2.set(29 * 40 + x, OIL);
    w2.set(28 * 40 + x, OIL);
  }
  for (let f = 0; f < 120; f++) w2.step();
  w2.set(28 * 40 + 15, FIRE);
  let oilCount = 0;
  for (let i = 0; i < w2.size; i++) if (w2.type[i] === OIL) oilCount++;
  console.log('oil before burn:', oilCount);
  for (let f = 0; f < 90; f++) {
    w2.step();
    let oil = 0, fire = 0;
    for (let i = 0; i < w2.size; i++) {
      if (w2.type[i] === OIL) oil++;
      if (w2.type[i] === FIRE) fire++;
    }
    if (f % 10 === 0) console.log(`f=${f} oil=${oil} fire=${fire}`);
  }
  dump(w2, 5, 24, 34, 31);
}

// --- seed debug
{
  const w2 = new World(40, 40);
  w2.set(20 * 40 + 20, SEED);
  w2.set(20 * 40 + 21, WATER);
  for (let f = 0; f < 10; f++) {
    w2.step();
    let s = -1, wat = -1;
    for (let i = 0; i < w2.size; i++) {
      if (w2.type[i] === SEED) s = i;
      if (w2.type[i] === WATER) wat = i;
    }
    const plant = w2.type.some((t) => t === PLANT);
    console.log(`f=${f} seed=${s >= 0 ? `(${s % 40},${(s / 40) | 0})` : 'gone'} water=${wat >= 0 ? `(${wat % 40},${(wat / 40) | 0})` : 'gone'} plant=${plant}`);
  }
}

// --- c4 debug: spark directly adjacent
{
  const w2 = new World(60, 60);
  for (let x = 25; x < 35; x++) for (let y = 25; y < 35; y++) w2.set(y * 60 + x, C4);
  w2.set(25 * 60 + 24, SPARK); // (24,25) directly left of C4 at (25,25)
  for (let f = 0; f < 60; f++) w2.step();
  let c4 = 0, smoke = 0, fire = 0;
  for (let i = 0; i < w2.size; i++) {
    if (w2.type[i] === C4) c4++;
    if (w2.type[i] === 19) smoke++;
    if (w2.type[i] === FIRE) fire++;
  }
  console.log('c4 adjacent spark: c4Left=', c4, 'smoke=', smoke, 'fire=', fire);
}
