// Map registry. Units are metres; +Y up.
// `MAP` is a live binding to the active map: the client sets it once per session,
// the server sets it at the start of every match tick / message (Node is single-threaded).

function box(x0, x1, z0, z1, h, mat, y0 = 0) {
  return {
    min: [Math.min(x0, x1), y0, Math.min(z0, z1)],
    max: [Math.max(x0, x1), y0 + h, Math.max(z0, z1)],
    mat,
  };
}

// Materials that bullets can punch through (wallbangs).
export const PENETRABLE = { wood: 1, crate: 1, door: 1 };

// ─── de_trenches: 3-lane defusal through a dug-in trench line. Bunkers hold both sites. ───────────────────────────────────
const trenches = {
  name: 'de_trenches',
  title: 'Trenches',
  theme: 'trenches',
  mode: 'defusal',
  bounds: { minX: -62, maxX: 62, minZ: -62, maxZ: 62 },
  wallH: 4.5,
  boxes: [
    box(-66, 66, -66, -62, 4.5, 'earth'),
    box(-66, 66, 62, 66, 4.5, 'earth'),
    box(-66, -62, -62, 62, 4.5, 'earth'),
    box(62, 66, -62, 62, 4.5, 'earth'),

    box(-62, -46, -10, 44, 3.8, 'earth'),
    box(-24, -8, 2, 44, 3.8, 'bunker'),
    box(-24, -8, -10, -4, 3.8, 'bunker'),
    box(8, 24, 2, 44, 3.8, 'bunker'),
    box(8, 24, -10, -6, 3.8, 'bunker'),
    box(46, 62, -10, 44, 3.8, 'earth'),

    box(-62, -24, -62, -48, 3.8, 'earth'),
    box(24, 62, -62, -48, 3.8, 'earth'),

    box(-24, -22, -44, -30, 3.8, 'earth'),
    box(-24, -22, -25, -10, 3.8, 'earth'),
    box(22, 24, -44, -20, 3.8, 'earth'),
    box(22, 24, -15, -10, 3.8, 'earth'),

    box(-46, -36, -12, -10, 3.8, 'earth'),
    box(-30, -24, -12, -10, 3.8, 'earth'),
    box(24, 32, -12, -10, 3.8, 'earth'),
    box(38, 46, -12, -10, 3.8, 'earth'),

    box(-22, -2.2, -11, -9.5, 3.8, 'door'),
    box(2.2, 22, -11, -9.5, 3.8, 'door'),

    box(-47, -45, -33, -31, 2, 'crate'),
    box(-45, -44, -33, -32, 1, 'crate'),
    box(-47, -46, -31, -30, 1, 'crate'),
    box(-35, -32, -41, -39.5, 1.2, 'sandbag'),
    box(-56, -53, -23, -21, 1, 'sandbag'),
    box(-53, -49, -41, -37.5, 2.3, 'metal'),
    box(-38, -36, -22, -20, 2, 'crate'),
    box(-60, -56, -46, -42, 3, 'wood'),

    box(42, 44, -31, -29, 2, 'crate'),
    box(44, 45, -30, -29, 1, 'crate'),
    box(50, 53.5, -39, -35.5, 3, 'bunker'),
    box(30, 33, -23, -21.5, 1.2, 'sandbag'),
    box(36, 38.5, -41, -39, 1, 'sandbag'),
    box(54, 57, -26, -22, 2, 'crate'),
    box(28, 30, -34, -32, 2, 'crate'),

    box(-39, -36, 20, 21.5, 1.2, 'sandbag'),
    box(-31, -29, 5, 7, 2, 'crate'),
    box(-44, -42, 30, 32, 1, 'crate'),
    box(30, 32, 18, 20, 2, 'crate'),
    box(38, 41, 4, 5.5, 1, 'sandbag'),
    box(42, 44, 30, 33, 2, 'crate'),

    box(-4, -1, 24, 25.5, 1.2, 'sandbag'),
    box(3, 5, 34, 36, 2, 'crate'),
    box(-6, -4, 8, 10, 1, 'crate'),
    box(-14, -12, -30, -28, 2, 'crate'),
    box(12, 15, -22, -20.5, 1.2, 'sandbag'),
    box(-2, 2, -36, -34, 1, 'crate'),

    // step crates so the 2 m stacks can be climbed
    box(-36, -35, -21.5, -20.5, 1, 'crate'),
    box(53, 54, -24.5, -23.5, 1, 'crate'),
    box(30, 31, -33.5, -32.5, 1, 'crate'),
    box(-29, -28, 5.5, 6.5, 1, 'crate'),
    box(32, 33, 18.5, 19.5, 1, 'crate'),
    box(41, 42, 31, 32, 1, 'crate'),
    box(2, 3, 34.5, 35.5, 1, 'crate'),
    box(-12, -11, -29.5, -28.5, 1, 'crate'),
    box(7, 8, -55.5, -54.5, 1, 'crate'),

    box(-6, 6, 55, 58, 2.6, 'metal'),
    box(-30, -26, 52, 54, 1.2, 'sandbag'),
    box(26, 30, 50, 52, 1.2, 'sandbag'),
    box(-10, -7, -58, -56, 1.2, 'sandbag'),
    box(8, 10, -56, -54, 2, 'crate'),
  ],
  spawns: {
    T: [[-2, 50], [2, 50], [-6, 49], [6, 49], [-10, 51], [10, 51], [-4, 46], [4, 46], [-14, 48], [14, 48]],
    CT: [[-2, -52], [2, -52], [-6, -51], [6, -51], [-12, -52], [12, -52], [-4, -47], [4, -47], [-15, -50], [15, -50]],
  },
  spawnYaw: { T: 0, CT: Math.PI },
  buyZones: {
    T: { minX: -30, maxX: 30, minZ: 42, maxZ: 62 },
    CT: { minX: -22, maxX: 22, minZ: -62, maxZ: -42 },
  },
  sites: {
    A: { name: 'A', minX: -54, maxX: -32, minZ: -42, maxZ: -18, center: [-42, -29] },
    B: { name: 'B', minX: 32, maxX: 56, minZ: -42, maxZ: -18, center: [43, -27] },
  },
  holdSpots: {
    A: [{ p: [-42, -36], look: [-33, -11] }, { p: [-51, -27], look: [-33, -11] }, { p: [-31, -44], look: [-23, -27] }],
    B: [{ p: [47, -33], look: [35, -11] }, { p: [52, -20], look: [35, -11] }, { p: [31, -45], look: [23, -17] }],
    mid: [{ p: [0, -30], look: [0, -10] }, { p: [-10, -40], look: [0, -10] }],
  },
  entries: { A: [[-33, -8], [-20, -27]], B: [[35, -8], [20, -17]] },
  silos: [],
  decor: {
    lamps: [
      [-46, 10, 1, 0], [-46, 30, 1, 0], [-24, 20, -1, 0], [-8, 25, 1, 0], [8, 15, -1, 0], [24, 30, 1, 0], [46, 12, -1, 0], [46, 32, -1, 0],
      [-24, -38, -1, 0], [-22, -40, 1, 0], [22, -35, -1, 0], [24, -30, 1, 0], [-40, -48, 0, 1], [40, -48, 0, 1], [0, -62, 0, 1], [0, 62, 0, -1],
    ],
    barrels: [[-45.35, 18], [-45.35, 18.7], [45.35, 36], [-7.35, 30], [24.7, -40], [-24.7, -20], [7.35, 22], [-61.3, -30], [61.3, -12], [-30, 61.3]],
  },
};
trenches.paved = [trenches.sites.A, trenches.sites.B];

// ─── dm_seoul: a Seoul street block at dusk — shops in the corners, a kiosk in the middle ───────────────────────
const ffaSpawns = [
  [-28, -28], [-24, -31], [28, -28], [31, -24], [-28, 28], [-31, 24], [28, 28], [24, 31],
  [0, -32], [0, 32], [-32, 0], [32, 0], [-15, -25], [15, 25], [-25, 15], [25, -15],
];
const seoulMap = {
  name: 'dm_seoul',
  title: 'Seoul',
  theme: 'seoul',
  mode: 'ffa',
  bounds: { minX: -35, maxX: 35, minZ: -35, maxZ: 35 },
  wallH: 14,
  boxes: [
    box(-37, 37, -37, -35, 14, 'facade'),
    box(-37, 37, 35, 37, 14, 'facade'),
    box(-37, -35, -35, 35, 14, 'facade'),
    box(35, 37, -35, 35, 14, 'facade'),

    // corner shops with two doorways each
    box(-21, -20, -35, -31, 4.2, 'shop'), box(-21, -20, -27, -20, 4.2, 'shop'),
    box(-35, -31, -21, -20, 4.2, 'shop'), box(-27, -21, -21, -20, 4.2, 'shop'),
    box(20, 21, -35, -31, 4.2, 'shop'), box(20, 21, -27, -20, 4.2, 'shop'),
    box(31, 35, -21, -20, 4.2, 'shop'), box(21, 27, -21, -20, 4.2, 'shop'),
    box(-21, -20, 31, 35, 4.2, 'shop'), box(-21, -20, 20, 27, 4.2, 'shop'),
    box(-35, -31, 20, 21, 4.2, 'shop'), box(-27, -21, 20, 21, 4.2, 'shop'),
    box(20, 21, 31, 35, 4.2, 'shop'), box(20, 21, 20, 27, 4.2, 'shop'),
    box(31, 35, 20, 21, 4.2, 'shop'), box(21, 27, 20, 21, 4.2, 'shop'),
    box(-34.8, -32.5, -34.8, -32.5, 2, 'crate'), box(32.5, 34.8, -34.8, -32.5, 2, 'crate'),
    box(-34.8, -32.5, 32.5, 34.8, 2, 'crate'), box(32.5, 34.8, 32.5, 34.8, 2, 'crate'),
    box(-24, -22.5, -24, -22.5, 1, 'crate'), box(22.5, 24, 22.5, 24, 1, 'crate'),

    // central kiosk and ring of cover
    box(-3.5, 3.5, -3.5, 3.5, 6, 'shop'),
    box(-11, -9, -1, 1, 2, 'crate'), box(9, 11, -1, 1, 2, 'crate'),
    box(-1, 1, -11, -9, 2, 'crate'), box(-1, 1, 9, 11, 2, 'crate'),
    // step crates next to the 2 m stacks
    box(-12, -11, -0.5, 0.5, 1, 'crate'), box(11, 12, -0.5, 0.5, 1, 'crate'),
    box(-0.5, 0.5, -12, -11, 1, 'crate'), box(-0.5, 0.5, 11, 12, 1, 'crate'),
    box(-0.5, 0.5, -27, -26, 1, 'crate'), box(-0.5, 0.5, 26, 27, 1, 'crate'),
    box(-27, -26, -0.5, 0.5, 1, 'crate'), box(26, 27, -0.5, 0.5, 1, 'crate'),
    box(-9, -6.5, -9, -7.8, 1.2, 'concrete'), box(6.5, 9, 7.8, 9, 1.2, 'concrete'),
    box(6.5, 9, -9, -7.8, 1.2, 'concrete'), box(-9, -6.5, 7.8, 9, 1.2, 'concrete'),

    // low brick walls
    box(-15, -13, 5, 15, 3, 'brick'), box(13, 15, -15, -5, 3, 'brick'),
    box(5, 15, 13, 15, 3, 'brick'), box(-15, -5, -15, -13, 3, 'brick'),

    // vending machines and delivery stacks so long diagonals are not free laser lanes
    box(-6.5, -4.8, 3.2, 5.2, 2.2, 'vending'), box(4.8, 6.5, -5.2, -3.2, 2.2, 'vending'),
    box(-18, -16.5, -6, -4.2, 1.6, 'crate'), box(16.5, 18, 4.2, 6, 1.6, 'crate'),

    // lanes: parked trucks, planters, crates
    box(-1, 1, -29, -27, 2, 'crate'), box(-1, 1, 27, 29, 2, 'crate'),
    box(-29, -27, -1, 1, 2, 'crate'), box(27, 29, -1, 1, 2, 'crate'),
    box(2, 4.5, -29, -27.8, 1.2, 'concrete'), box(-4.5, -2, 27.8, 29, 1.2, 'concrete'),
    box(-29, -27.8, -4.5, -2, 1.2, 'concrete'), box(27.8, 29, 2, 4.5, 1.2, 'concrete'),
    box(8, 14, -31, -28.5, 2.6, 'car'), box(-14, -8, 28.5, 31, 2.6, 'car'),
    box(-31, -28.5, 8, 14, 2.6, 'car'), box(28.5, 31, -14, -8, 2.6, 'car'),
  ],
  spawns: { FFA: ffaSpawns, T: ffaSpawns, CT: ffaSpawns },
  spawnYaw: { T: 0, CT: 0 },
  buyZones: {},
  sites: {},
  roam: [...ffaSpawns, [0, -17], [0, 17], [-17, 0], [17, 0], [-8, 4], [8, -4], [4, 8], [-4, -8]],
  silos: [],
  decor: {
    lamps: [[-35, -10, 1, 0], [35, 10, -1, 0], [10, -35, 0, 1], [-10, 35, 0, -1], [-20, -23, 1, 0], [20, 23, -1, 0], [-3.5, 1.5, -1, 0], [3.5, -1.5, 1, 0]],
    barrels: [[-34.65, -10], [34.65, 10], [-19.65, -33], [19.65, 33], [-3.85, 3], [3.85, -3]],
  },
  paved: [{ minX: -17, maxX: 17, minZ: -17, maxZ: 17 }],
};

// ─── aim_rooftop: symmetrical 1v1 duel on a Seoul rooftop ───────────────────────
const duelSpawns = [[-21, -8], [-21, 0], [-21, 8], [-18, -11], [-18, 11], [21, 8], [21, 0], [21, -8], [18, 11], [18, -11]];
const rooftopMap = {
  name: 'aim_rooftop',
  title: 'Rooftop',
  theme: 'rooftop',
  mode: 'duel',
  bounds: { minX: -24, maxX: 24, minZ: -16, maxZ: 16 },
  wallH: 5,
  boxes: [
    box(-26, 26, -18, -16, 5, 'parapet'),
    box(-26, 26, 16, 18, 5, 'parapet'),
    box(-26, -24, -16, 16, 5, 'parapet'),
    box(24, 26, -16, 16, 5, 'parapet'),

    // stairwell housing with steps on both sides (0.4 m)
    box(-3, 3, -3, 3, 1.2, 'concrete'),
    box(-1.5, 1.5, 3, 4, 0.8, 'concrete'), box(-1.5, 1.5, 4, 5, 0.4, 'concrete'),
    box(-1.5, 1.5, -4, -3, 0.8, 'concrete'), box(-1.5, 1.5, -5, -4, 0.4, 'concrete'),
    box(-5, -4, -1, 1, 1, 'steel'), box(4, 5, -1, 1, 1, 'steel'),

    // rotationally symmetric cover
    box(-12, -10, -8, -6, 2, 'steel'), box(10, 12, 6, 8, 2, 'steel'),
    box(-10, -9, -7.5, -6.5, 1, 'crate'), box(9, 10, 6.5, 7.5, 1, 'crate'),
    box(-12, -9, 5, 6.2, 1.2, 'wood'), box(9, 12, -6.2, -5, 1.2, 'wood'),
    box(-7, -6, -14, -9, 1.4, 'concrete'), box(6, 7, 9, 14, 1.4, 'concrete'),
    box(-7, -6, 9, 12, 1.4, 'concrete'), box(6, 7, -12, -9, 1.4, 'concrete'),
    box(-17, -15, -2, 2, 3, 'metal'), box(15, 17, -2, 2, 3, 'metal'),
    box(-21, -19, -14, -12, 1, 'crate'), box(19, 21, 12, 14, 1, 'crate'),
  ],
  spawns: { FFA: duelSpawns, T: duelSpawns, CT: duelSpawns },
  spawnYaw: { T: 0, CT: 0 },
  buyZones: {},
  sites: {},
  roam: [...duelSpawns, [0, -8], [0, 8], [-10, 0], [10, 0], [-13, -11], [13, 11]],
  silos: [],
  decor: {
    lamps: [[-24, 0, 1, 0], [24, 0, -1, 0], [0, -16, 0, 1], [0, 16, 0, -1]],
    barrels: [[-23.65, -14], [23.65, 14]],
  },
  paved: [{ minX: -6, maxX: 6, minZ: -6, maxZ: 6 }],
};

export const MAPS = { de_trenches: trenches, dm_seoul: seoulMap, aim_rooftop: rooftopMap };

export const MODES = {
  defusal: { id: 'defusal', name: 'Defusal', desc: '5v5 · Plant or defuse the C4', map: 'de_trenches' },
  ffa: { id: 'ffa', name: 'Free-for-all', desc: 'Everyone vs everyone · First to 20 kills', map: 'dm_seoul' },
  duel: { id: 'duel', name: '1v1 Duel', desc: 'Head-to-head · First to 10 kills', map: 'aim_rooftop' },
};

export let MAP = trenches;

/** Accepts a map name or a map object (e.g. from instanceMap). */
export function setActiveMap(nameOrMap) {
  MAP = typeof nameOrMap === 'object' && nameOrMap ? nameOrMap : (MAPS[nameOrMap] || trenches);
  return MAP;
}

/** A private copy of a map whose box list can hold placed barricades. */
export function instanceMap(name) {
  const base = MAPS[name] || trenches;
  return { ...base, boxes: [...base.boxes] };
}

export function inRect(r, x, z) {
  return !!r && x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ;
}

export function siteAt(x, z) {
  for (const s of Object.values(MAP.sites)) if (inRect(s, x, z)) return s.name;
  return null;
}
