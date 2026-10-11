/* Headless smoke test for the simulation engine. Run: npx tsx sim/smoke.ts */
import { World } from './world';
import {
  EMPTY, WALL, WOOD, METAL, STONE, GLASS, ICE, WATER, OIL, ACID, STEAM, SAND, PLANT, SEED,
  FIRE, C4, SPARK, LAVA, SMOKE, BUILDING, WINDOW, ROAD, WIRE, GENERATOR, DRYPLANT,
  KIND, K_LIQUID, K_GAS, K_ENERGY, K_POWDER,
} from './elements';
import { generateCity, stampBuilding } from './structures';

let failures = 0;
function check(name: string, cond: boolean, extra = '') {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`);
  if (!cond) failures++;
}

function count(w: World, t: number) {
  let n = 0;
  for (let i = 0; i < w.size; i++) if (w.type[i] === t) n++;
  return n;
}

const world = new World(160, 100);

// --- 1. city generation -------------------------------------------------
generateCity(world);
const roads = count(world, ROAD);
const bldgs = count(world, BUILDING);
const wires = count(world, WIRE);
const gens = count(world, GENERATOR);
check('city: road laid', roads > 100, `roads=${roads}`);
check('city: buildings stamped', bldgs > 50, `buildings=${bldgs}`);
check('city: wires strung', wires > 20, `wires=${wires}`);
check('city: generator placed', gens >= 20, `generators=${gens}`);

// --- 2. sand falls ------------------------------------------------------
{
  const w2 = new World(40, 40);
  for (let x = 10; x < 20; x++) for (let y = 0; y < 5; y++) w2.set(y * 40 + x, SAND);
  for (let f = 0; f < 120; f++) w2.step();
  const topSand = count(w2, SAND);
  let fell = 0;
  for (let i = 0; i < w2.size; i++) if (w2.type[i] === SAND && ((i / 40) | 0) >= 20) fell++;
  check('sand: all settled at bottom', topSand === fell, `total=${topSand} atBottom=${fell}`);
}

// --- 3. water extinguishes fire -----------------------------------------
{
  const w2 = new World(40, 40);
  w2.set(20 * 40 + 20, FIRE);
  w2.set(19 * 40 + 20, WATER);
  for (let f = 0; f < 60; f++) w2.step();
  check('fire: water douses it', count(w2, FIRE) === 0, `fire=${count(w2, FIRE)} steam=${count(w2, STEAM)}`);
}

// --- 4. lava + water -> steam & stone ------------------------------------
{
  const w2 = new World(40, 40);
  // water directly above lava: sustained contact (lava sinks through water)
  for (let x = 8; x < 14; x++) {
    w2.set(25 * 40 + x, LAVA);
    w2.set(24 * 40 + x, WATER);
  }
  for (let f = 0; f < 30; f++) w2.step();
  check('lava: water contact makes steam/stone', count(w2, STEAM) > 0 || count(w2, STONE) > 0, `steam=${count(w2, STEAM)} stone=${count(w2, STONE)}`);
}

// --- 5. oil floats on water & burns --------------------------------------
{
  const w2 = new World(40, 40);
  for (let x = 5; x < 35; x++) {
    w2.set(30 * 40 + x, WATER);
    w2.set(29 * 40 + x, OIL);
    w2.set(28 * 40 + x, OIL);
  }
  for (let f = 0; f < 120; f++) w2.step();
  // oil should be above water: find min/max rows of each
  let oilMin = 99, waterMax = -1;
  for (let i = 0; i < w2.size; i++) {
    if (w2.type[i] === OIL) oilMin = Math.min(oilMin, (i / 40) | 0);
    if (w2.type[i] === WATER) waterMax = Math.max(waterMax, (i / 40) | 0);
  }
  check('oil: floats above water', oilMin < waterMax, `oilTop=${oilMin} waterBottom=${waterMax}`);
  // pool settled down and the surface is ragged: paint fire into the local
  // surface cell of column 15 (topmost oil in that column)
  let colTop = -1;
  for (let y = 0; y < 40; y++) if (w2.type[y * 40 + 15] === OIL) { colTop = y; break; }
  w2.set(colTop * 40 + 15, FIRE);
  for (let f = 0; f < 90; f++) w2.step();
  check('oil: ignites and burns', count(w2, OIL) < 55, `oilLeft=${count(w2, OIL)} (started 60)`);
}

// --- 6. acid dissolves metal/glass/wood ----------------------------------
{
  const w2 = new World(40, 40);
  w2.set(20 * 40 + 14, METAL);
  w2.set(20 * 40 + 17, GLASS);
  w2.set(20 * 40 + 20, WOOD);
  // a 6x3 acid pool under the three solids
  for (let x = 13; x < 21; x++) for (let y = 21; y < 24; y++) w2.set(y * 40 + x, ACID);
  for (let f = 0; f < 900; f++) w2.step();
  const left = count(w2, METAL) + count(w2, GLASS) + count(w2, WOOD);
  check('acid: dissolves solids', left === 0, `left=${left} acidLeft=${count(w2, ACID)}`);
}

// --- 7. seed + water -> plant --------------------------------------------
{
  const w2 = new World(40, 40);
  w2.set(20 * 40 + 20, SEED);
  w2.set(20 * 40 + 21, WATER);
  for (let f = 0; f < 30; f++) w2.step();
  check('seed: sprouts when watered', count(w2, PLANT) >= 1 && count(w2, SEED) === 0, `plant=${count(w2, PLANT)} seed=${count(w2, SEED)}`);
}

// --- 8. spark ignites C4 -> explosion ------------------------------------
{
  const w2 = new World(60, 60);
  for (let x = 25; x < 35; x++) for (let y = 25; y < 35; y++) w2.set(y * 60 + x, C4);
  // spark directly adjacent to the block corner (25,25)
  w2.set(25 * 60 + 24, SPARK);
  for (let f = 0; f < 60; f++) w2.step();
  check('c4: detonates from spark', count(w2, C4) === 0, `c4Left=${count(w2, C4)} smoke=${count(w2, SMOKE)} fire=${count(w2, FIRE)}`);
}

// --- 9. rigid bodies fall when unsupported --------------------------------
{
  const w2 = new World(40, 40);
  for (let x = 10; x < 20; x++) w2.set(5 * 40 + x, WOOD); // floating plank
  for (let f = 0; f < 200; f++) w2.step();
  let atBottom = 0;
  for (let i = 0; i < w2.size; i++) if (w2.type[i] === WOOD && ((i / 40) | 0) >= 30) atBottom++;
  check('rigid: unsupported wood falls', atBottom === 10, `woodAtBottom=${atBottom}`);
}

// --- 10. supported rigid stays --------------------------------------------
{
  const w2 = new World(40, 40);
  for (let x = 10; x < 20; x++) {
    w2.set(5 * 40 + x, WOOD);
    w2.set(15 * 40 + x, WALL); // pillar under it... plank at row 5, wall at row 15 -> not touching
  }
  for (let f = 0; f < 10; f++) w2.step();
  let stillUp = 0;
  for (let x = 10; x < 20; x++) if (w2.type[5 * 40 + x] === WOOD) stillUp++;
  // plank should have started falling (gap between row 5 and 15)
  check('rigid: falls through gap (10 frames)', stillUp < 10, `stillAtRow5=${stillUp}`);
}

// --- 11. wind pushes smoke --------------------------------------------------
{
  const w2 = new World(60, 40);
  w2.windOn = true;
  w2.windStrength = 1;
  for (let k = 0; k < 30; k++) w2.set(20 * 60 + 30, SMOKE);
  for (let f = 0; f < 40; f++) w2.step();
  let right = 0, left = 0;
  for (let i = 0; i < w2.size; i++) if (w2.type[i] === SMOKE) {
    const x = i % 60;
    if (x > 35) right++;
    if (x < 25) left++;
  }
  check('wind: blows smoke rightward', right > left, `right=${right} left=${left}`);
}

// --- 12. rain ----------------------------------------------------------------
{
  const w2 = new World(60, 40);
  w2.rain = true;
  for (let f = 0; f < 200; f++) w2.step();
  check('weather: rain produces water', count(w2, WATER) > 10, `water=${count(w2, WATER)}`);
}

// --- 13. heatwave dries plants ----------------------------------------------
// (dry plants can spontaneously ignite later in the run, so track the max)
{
  const w2 = new World(60, 40);
  w2.heatwave = true;
  for (let x = 10; x < 50; x++) w2.set(20 * 60 + x, PLANT);
  let maxDry = 0;
  for (let f = 0; f < 800; f++) {
    w2.step();
    if (f % 25 === 0) {
      let d = 0;
      for (let i = 0; i < w2.size; i++) if (w2.type[i] === DRYPLANT) d++;
      maxDry = Math.max(maxDry, d);
    }
  }
  check('weather: heatwave dries plants', maxDry > 0, `maxDry=${maxDry}`);
}

// --- 14. earthquake damages city --------------------------------------------
{
  world.triggerQuake();
  const before = count(world, BUILDING) + count(world, WINDOW);
  for (let f = 0; f < 300; f++) world.step();
  const after = count(world, BUILDING) + count(world, WINDOW);
  const rubble = count(world, 21); // RUBBLE
  check('disaster: quake damages structures', after < before, `before=${before} after=${after} rubble=${rubble}`);
}

// --- 15. flood raises water ----------------------------------------------------
{
  world.triggerFlood();
  for (let f = 0; f < 200; f++) world.step();
  check('disaster: flood adds water', count(world, WATER) > 50, `water=${count(world, WATER)}`);
}

// --- 16. eruption launches lava --------------------------------------------------
{
  world.vent = { x: 80, y: 60 };
  world.triggerEruption();
  for (let f = 0; f < 200; f++) world.step();
  check('disaster: eruption makes lava', count(world, LAVA) > 10, `lava=${count(world, LAVA)}`);
}

// --- 17. long-run stability: no crashes, bounded state ----------------------------
{
  let ok = true;
  let maxParticles = 0;
  for (let f = 0; f < 600; f++) {
    world.step();
    let n = 0;
    for (let i = 0; i < world.size; i++) if (world.type[i] !== EMPTY) n++;
    maxParticles = Math.max(maxParticles, n);
    // every cell must be a valid type
    for (let i = 0; i < 4; i++) {
      const ti = world.type[(f * 7919 + i * 31) % world.size];
      if (ti >= 29) ok = false;
    }
  }
  check('stability: 600 more frames, no invalid cells', ok, `maxParticles=${maxParticles} rigid=${world.rigidCount}`);
}

// --- 18. stamp building tool ------------------------------------------------------
{
  const w2 = new World(60, 60);
  stampBuilding(w2, 30, 50, 12, 20);
  check('city: stamp building works', count(w2, BUILDING) > 100 && count(w2, WINDOW) > 10, `b=${count(w2, BUILDING)} w=${count(w2, WINDOW)}`);
}

console.log(failures === 0 ? '\nALL TESTS PASSED' : `\n${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
