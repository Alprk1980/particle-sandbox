import { World } from './world';
import { EMPTY, WATER, OIL, FIRE, C4, SPARK } from './elements';

// ---------- instrument ----------
const w1 = new World(60, 60);
let detonations = 0;
const origDetonate = w1.detonate.bind(w1);
(w1 as any).detonate = (j: number) => { detonations++; console.log(`  detonate called at (${j % 60},${(j / 60) | 0}) type=${w1.type[j]} pending=${w1.pending.length}`); return origDetonate(j); };

for (let x = 25; x < 35; x++) for (let y = 25; y < 35; y++) w1.set(y * 60 + x, C4);
w1.set(25 * 60 + 24, SPARK);
console.log('spark placed, life =', w1.life[25 * 60 + 24]);
for (let f = 0; f < 10; f++) {
  const si = w1.type.indexOf(SPARK);
  w1.step();
  console.log(`f=${f} sparkAt=${si >= 0 ? `(${si % 60},${(si / 60) | 0})` : 'gone'} pending=${w1.pending.length} detonations=${detonations}`);
}

// ---------- oil: trace ignition calls ----------
const w2 = new World(40, 40);
let ignites = 0;
const origIgnite = w2.ignite.bind(w2);
(w2 as any).ignite = (j: number) => { ignites++; if (ignites < 5) console.log(`  ignite called at (${j % 40},${(j / 40) | 0}) type=${w2.type[j]}`); return origIgnite(j); };
let fireChecks = 0;
const origFire = w2['updateFire'].bind(w2);
(w2 as any)['updateFire'] = (x: number, y: number, i: number) => {
  fireChecks++;
  const res = origFire(x, y, i);
  return res;
};

for (let x = 5; x < 35; x++) {
  w2.set(30 * 40 + x, WATER);
  w2.set(29 * 40 + x, OIL);
  w2.set(28 * 40 + x, OIL);
}
for (let f = 0; f < 120; f++) w2.step();
w2.set(28 * 40 + 15, FIRE);
console.log('oil pool set, fire placed, life =', w2.life[28 * 40 + 15]);
for (let f = 0; f < 35; f++) {
  const fi = w2.type.indexOf(FIRE);
  w2.step();
  if (f % 5 === 0) console.log(`f=${f} fireAt=${fi >= 0 ? `(${fi % 40},${(fi / 40) | 0})` : 'gone'} fireChecks=${fireChecks} ignites=${ignites}`);
}
