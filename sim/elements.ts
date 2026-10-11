// Element ids, behaviour tables and colour palette for the simulation.

export const EMPTY = 0;
export const WALL = 1;
export const WOOD = 2;
export const METAL = 3;
export const STONE = 4;
export const GLASS = 5;
export const ICE = 6;
export const WATER = 7;
export const OIL = 8;
export const ACID = 9;
export const STEAM = 10;
export const WIND = 11; // brush only: writes into the wind force field, never a cell
export const SAND = 12;
export const PLANT = 13;
export const SEED = 14;
export const FIRE = 15;
export const C4 = 16;
export const SPARK = 17;
export const LAVA = 18;
export const SMOKE = 19;
export const ASH = 20;
export const RUBBLE = 21;
export const SHARD = 22;
export const BUILDING = 23;
export const WINDOW = 24;
export const ROAD = 25;
export const WIRE = 26;
export const GENERATOR = 27;
export const DRYPLANT = 28;
export const LEAF = 29;
export const NUM_TYPES = 30;

// Movement kinds
export const K_NONE = 0;
export const K_STATIC = 1;
export const K_POWDER = 2;
export const K_LIQUID = 3;
export const K_GAS = 4;
export const K_ENERGY = 5;

export const KIND = new Uint8Array(NUM_TYPES);
export const DENSITY = new Float32Array(NUM_TYPES);
/** Rigid solids are grouped into connected bodies that fall when unsupported. */
export const RIGID = new Uint8Array(NUM_TYPES);
/** Chance per contact tick to ignite. */
export const FLAMMABLE = new Float32Array(NUM_TYPES);
/** Base burn duration in ticks for flammable solids. */
export const BURN_TIME = new Uint16Array(NUM_TYPES);
/** Chance per tick that acid dissolves this element. */
export const DISSOLVE = new Float32Array(NUM_TYPES);
export const CONDUCTIVE = new Uint8Array(NUM_TYPES);
/** Rigid cells that are held up by liquid (buoyant). */
export const FLOATS = new Uint8Array(NUM_TYPES);
/** Shatters when it lands after a long fall. */
export const FRAGILE = new Uint8Array(NUM_TYPES);

function def(
  t: number,
  kind: number,
  o: {
    density?: number;
    rigid?: boolean;
    flam?: number;
    burn?: number;
    dissolve?: number;
    conductive?: boolean;
    floats?: boolean;
    fragile?: boolean;
  } = {},
) {
  KIND[t] = kind;
  DENSITY[t] = o.density ?? 0;
  RIGID[t] = o.rigid ? 1 : 0;
  FLAMMABLE[t] = o.flam ?? 0;
  BURN_TIME[t] = o.burn ?? 0;
  DISSOLVE[t] = o.dissolve ?? 0;
  CONDUCTIVE[t] = o.conductive ? 1 : 0;
  FLOATS[t] = o.floats ? 1 : 0;
  FRAGILE[t] = o.fragile ? 1 : 0;
}

def(EMPTY, K_NONE);
def(WALL, K_STATIC);
def(WOOD, K_STATIC, { rigid: true, flam: 0.035, burn: 260, dissolve: 0.06, floats: true });
def(METAL, K_STATIC, { rigid: true, dissolve: 0.02, conductive: true });
def(STONE, K_STATIC, { rigid: true, dissolve: 0.008 });
def(GLASS, K_STATIC, { rigid: true, dissolve: 0.03, fragile: true });
def(ICE, K_STATIC, { rigid: true, dissolve: 0.05, floats: true, fragile: true });
def(WATER, K_LIQUID, { density: 2, conductive: true });
def(OIL, K_LIQUID, { density: 1, flam: 0.3 });
def(ACID, K_LIQUID, { density: 3 });
def(STEAM, K_GAS);
def(WIND, K_NONE);
def(SAND, K_POWDER, { density: 10, dissolve: 0.01 });
def(PLANT, K_STATIC, { flam: 0.06, burn: 50, dissolve: 0.1 });
def(SEED, K_POWDER, { density: 6, flam: 0.1, burn: 20, dissolve: 0.1 });
def(FIRE, K_ENERGY);
def(C4, K_STATIC, { rigid: true, dissolve: 0.04 });
def(SPARK, K_ENERGY);
def(LAVA, K_LIQUID, { density: 5 });
def(SMOKE, K_GAS);
def(ASH, K_POWDER, { density: 4, dissolve: 0.1 });
def(RUBBLE, K_POWDER, { density: 10, dissolve: 0.02 });
def(SHARD, K_POWDER, { density: 9, dissolve: 0.03 });
def(BUILDING, K_STATIC, { rigid: true, flam: 0.004, burn: 420, dissolve: 0.03, fragile: true });
def(WINDOW, K_STATIC, { rigid: true, dissolve: 0.03, fragile: true });
def(ROAD, K_STATIC, { rigid: true, dissolve: 0.01 });
def(WIRE, K_STATIC, { rigid: true, dissolve: 0.04, conductive: true });
def(GENERATOR, K_STATIC, { rigid: true, conductive: false });
def(DRYPLANT, K_STATIC, { flam: 0.3, burn: 25, dissolve: 0.1 });
// Light enough to float on water (2) but not on oil (1).
def(LEAF, K_POWDER, { density: 1.5, flam: 0.25, dissolve: 0.15 });

// ---------- Palette ----------
export const SHADES = 32;

function hex(c: string): [number, number, number] {
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgba(r: number, g: number, b: number): number {
  // ImageData Uint32 view is little-endian ABGR
  return (
    (255 << 24) |
    (Math.max(0, Math.min(255, b | 0)) << 16) |
    (Math.max(0, Math.min(255, g | 0)) << 8) |
    Math.max(0, Math.min(255, r | 0))
  ) >>> 0;
}

export const BG: [number, number, number] = [7, 9, 15];
export const BG_COLOR = rgba(...BG);

const BASE: Record<number, [string, number]> = {
  [WALL]: ['#5b6272', 0.08],
  [WOOD]: ['#8a5a2e', 0.18],
  [METAL]: ['#8e9bad', 0.1],
  [STONE]: ['#6f6a66', 0.18],
  [GLASS]: ['#8fd3e4', 0.08],
  [ICE]: ['#bfeeff', 0.08],
  [WATER]: ['#2b74f0', 0.1],
  [OIL]: ['#5a4320', 0.15],
  [ACID]: ['#7dff3a', 0.15],
  [STEAM]: ['#c4d2e0', 0.08],
  [SAND]: ['#e0bf78', 0.16],
  [PLANT]: ['#36b84a', 0.25],
  [SEED]: ['#c4975a', 0.18],
  [FIRE]: ['#ff8a1c', 0.2],
  [C4]: ['#e6dcc0', 0.07],
  [SPARK]: ['#fff3a0', 0.1],
  [LAVA]: ['#ff5a14', 0.3],
  [SMOKE]: ['#4b4b55', 0.12],
  [ASH]: ['#8a8580', 0.15],
  [RUBBLE]: ['#8b8377', 0.25],
  [SHARD]: ['#c5eef8', 0.15],
  [BUILDING]: ['#9aa0aa', 0.35],
  [WINDOW]: ['#ffd36a', 0.0],
  [ROAD]: ['#2d3038', 0.08],
  [WIRE]: ['#d6874a', 0.08],
  [GENERATOR]: ['#2c3b33', 0.06],
  [DRYPLANT]: ['#b59a4a', 0.2],
};

/** PALETTE[type * SHADES + shade>>3] */
export const PALETTE = new Uint32Array(NUM_TYPES * SHADES);
for (let t = 0; t < NUM_TYPES; t++) {
  const b = BASE[t];
  for (let s = 0; s < SHADES; s++) {
    if (!b) {
      PALETTE[t * SHADES + s] = BG_COLOR;
      continue;
    }
    const [r, g, bl] = hex(b[0]);
    const k = 1 + ((s / (SHADES - 1)) * 2 - 1) * b[1];
    PALETTE[t * SHADES + s] = rgba(r * k, g * k, bl * k);
  }
}

// Autumn leaves span a red → orange → gold gradient instead of one tint.
const AUTUMN = ['#9e2a1c', '#c4441f', '#e06a1f', '#e8902a', '#d9a53a', '#b5752a'].map(hex);
for (let s = 0; s < SHADES; s++) {
  const f = (s / SHADES) * (AUTUMN.length - 1);
  const a = AUTUMN[f | 0];
  const b = AUTUMN[Math.min(AUTUMN.length - 1, (f | 0) + 1)];
  const u = f - (f | 0);
  PALETTE[LEAF * SHADES + s] = rgba(a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u);
}

// Swatch info for the UI
export interface ElementInfo {
  id: number;
  name: string;
  color: string;
  key?: string;
}

export const ELEMENT_GROUPS: { title: string; items: ElementInfo[] }[] = [
  {
    title: 'Solids',
    items: [
      { id: WALL, name: 'Wall', color: '#5b6272' },
      { id: WOOD, name: 'Wood', color: '#8a5a2e' },
      { id: METAL, name: 'Metal', color: '#8e9bad' },
      { id: STONE, name: 'Stone', color: '#6f6a66' },
      { id: GLASS, name: 'Glass', color: '#8fd3e4' },
      { id: ICE, name: 'Ice', color: '#bfeeff' },
    ],
  },
  {
    title: 'Liquids & Gases',
    items: [
      { id: WATER, name: 'Water', color: '#2b74f0' },
      { id: OIL, name: 'Oil', color: '#7a5a28' },
      { id: ACID, name: 'Acid', color: '#7dff3a' },
      { id: STEAM, name: 'Steam', color: '#c4d2e0' },
      { id: WIND, name: 'Wind', color: '#58e6ff' },
    ],
  },
  {
    title: 'Granular & Organic',
    items: [
      { id: SAND, name: 'Sand', color: '#e0bf78' },
      { id: PLANT, name: 'Plant', color: '#36b84a' },
      { id: SEED, name: 'Seeds', color: '#c4975a' },
      { id: LEAF, name: 'Autumn Leaves', color: '#e06a1f' },
    ],
  },
  {
    title: 'Volatiles & Hazards',
    items: [
      { id: FIRE, name: 'Fire', color: '#ff8a1c' },
      { id: C4, name: 'C4', color: '#e6dcc0' },
      { id: SPARK, name: 'Sparks', color: '#fff3a0' },
      { id: LAVA, name: 'Lava', color: '#ff5a14' },
    ],
  },
  {
    title: 'Infrastructure',
    items: [
      { id: WIRE, name: 'Wire', color: '#d6874a' },
      { id: GENERATOR, name: 'Generator', color: '#3ddc84' },
      { id: ROAD, name: 'Road', color: '#3a3e48' },
    ],
  },
];

export const ELEMENT_NAMES: Record<number, string> = {};
for (const g of ELEMENT_GROUPS) for (const it of g.items) ELEMENT_NAMES[it.id] = it.name;
ELEMENT_NAMES[BUILDING] = 'Building';
