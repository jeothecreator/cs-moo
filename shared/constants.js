// Shared game constants — imported by both the Node server and the browser client.

export const TICK_RATE = 60;
export const SNAPSHOT_RATE = 30;
export const INTERP_DELAY = 100; // ms
export const LAG_COMP_MAX = 1000; // ms of hitbox history kept on the server

export const TEAMS = {
  T: { id: 'T', name: 'Insurgents', short: 'INS', color: '#d9a441' },
  CT: { id: 'CT', name: 'Task Force', short: 'TF', color: '#5d9cec' },
};

export const ROUND = {
  BUY_TIME: Number(globalThis.process?.env?.BUY_TIME ?? 15),
  ACTION_TIME: 105,
  END_TIME: 5,
  WIN_ROUNDS: 8,
  HALFTIME_AFTER: 7,
  BOMB_TIMER: 40,
  PLANT_TIME: 3.2,
  DEFUSE_TIME: 10,
  DEFUSE_TIME_KIT: 5,
  MATCH_END_TIME: 12,
};

export const FFA = {
  TIME: 480,
  FRAG_LIMIT: 20,
  RESPAWN: 5,
  PROTECT: 4,
  WARMUP: 8,
  PLAYERS: 6,
  MAX_HUMANS: 12,
  BUY_WINDOW: 10,
};

export const DUEL = {
  TIME: 300,
  FRAG_LIMIT: 10,
  RESPAWN: 2.5,
  PROTECT: 1.5,
  WARMUP: 5,
  PLAYERS: 2,
  MAX_HUMANS: 2,
  BUY_WINDOW: 10,
};

export function modeConfig(mode) {
  return mode === 'duel' ? DUEL : FFA;
}

// Placeable sandbag barricades.
export const BLOCKS = {
  PER_LIFE: { defusal: 6, ffa: 15, duel: 20 },
  REACH: 5,
  HP: 120,
  LIFETIME: 90,
  MAX_HEIGHT: 8,
  COOLDOWN: 0.2,
};

// Health regeneration: after DELAY seconds without taking damage, heal RATE hp per second.
export const REGEN = { DELAY: 4, RATE: 12 };

// Player-side accuracy helpers (bots keep the raw weapon values).
export const HUMAN_SPREAD = 0.6;
export const RECOIL_VIEW = 0.6;
export const DEFAULT_PRIMARY = 'carbine';

export const ECON = {
  START: 800,
  MAX: 16000,
  WIN: 3250,
  LOSS_BASE: 1400,
  LOSS_INC: 500,
  LOSS_MAX: 3400,
  PLANT_BONUS: 800,
  PLANT_REWARD: 300,
  DEFUSE_REWARD: 300,
  TEAMKILL_PENALTY: -300,
};

export const PLAYER = {
  RADIUS: 0.4,
  HEIGHT: 1.8,
  CROUCH_HEIGHT: 1.25,
  EYE: 1.62,
  CROUCH_EYE: 1.08,
  SPEED: 6.2,
  WALK_MULT: 0.52,
  CROUCH_MULT: 0.34,
  JUMP_V: 7.0,
  GRAVITY: 20,
  GROUND_ACCEL: 11,
  AIR_ACCEL: 60,
  AIR_WISH: 0.85,
  FRICTION: 6,
  STOP_SPEED: 2.5,
  STEP: 0.45,
  MAX_HP: 100,
};

// Recoil patterns: cumulative [yawDeg, pitchDeg] per shot index.
function pattern(n, fn) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(fn(i));
  return out;
}

export const RECOIL = {
  // M4: tight first shots, then a climb that drifts right and settles into a left–right sway.
  carbine: pattern(30, (i) => [
    i < 7 ? 0.12 * Math.sin(i * 1.3) : 1.6 * Math.sin((i - 7) / 4.2) + 0.35 * Math.sin(i * 1.9),
    Math.min(i, 10) * 0.7 + Math.max(0, i - 10) * 0.08,
  ]),
  p9: pattern(20, (i) => [0.35 * Math.sin(i * 1.9), Math.min(i * 1.1, 7)]),
  none: [[0, 0]],
};

export const WEAPONS = {
  knife: {
    id: 'knife', name: 'Combat Knife', slot: 'melee', cls: 'Knife', price: 0, team: 'any',
    damage: { head: 40, body: 40, leg: 40 }, altDamage: 65, armorPen: 0.85,
    rpm: 120, mag: 0, reserve: 0, reload: 0, auto: true, pellets: 1,
    spread: 0, moveSpread: 0, jumpSpread: 0, range: 1.9, falloff: 1,
    speedMult: 1.0, killReward: 1500, recoil: 'none', penetration: 0, deploy: 0.4,
  },
  p9: {
    id: 'p9', name: 'P9 Pistol', slot: 'secondary', cls: 'Pistol', price: 0, team: 'any',
    damage: { head: 104, body: 26, leg: 21 }, armorPen: 0.905,
    rpm: 500, mag: 18, reserve: 90, reload: 2.5, auto: false, pellets: 1,
    spread: 0.0045, moveSpread: 0.012, jumpSpread: 0.09, range: 120, falloff: 0.96,
    speedMult: 0.97, killReward: 300, recoil: 'p9', penetration: 1, deploy: 0.6, recovery: 9,
  },
  carbine: {
    id: 'carbine', name: 'M4 Carbine', slot: 'primary', cls: 'Rifle', price: 3100, team: 'any',
    damage: { head: 130, body: 33, leg: 25 }, armorPen: 0.7,
    rpm: 666, mag: 30, reserve: 90, reload: 3.0, auto: true, pellets: 1,
    spread: 0.0022, moveSpread: 0.042, jumpSpread: 0.12, range: 200, falloff: 0.985,
    speedMult: 0.9, killReward: 300, recoil: 'carbine', penetration: 2, deploy: 1.0, recovery: 12,
  },
  // Utilities
  flashbang: { id: 'flashbang', name: 'Flashbang', slot: 'grenade', cls: 'Grenade', price: 200, team: 'any', max: 2, speedMult: 1, fuse: 1.6 },
  molotov: { id: 'molotov', name: 'Molotov', slot: 'grenade', cls: 'Grenade', price: 400, team: 'any', max: 1, speedMult: 1, fuse: 2.0 },
  smoke: { id: 'smoke', name: 'Smoke Grenade', slot: 'grenade', cls: 'Grenade', price: 300, team: 'any', max: 1, speedMult: 1, fuse: 3.0 },
  he: { id: 'he', name: 'HE Grenade', slot: 'grenade', cls: 'Grenade', price: 300, team: 'any', max: 1, speedMult: 1, fuse: 1.6 },
  barricade: { id: 'barricade', name: 'Sandbag Barricade', slot: 'block', cls: 'Block', price: 0, team: 'any', speedMult: 1 },
  stomp: { id: 'stomp', name: 'Boot Stomp', slot: 'special', cls: 'Special', price: 0, team: 'any', speedMult: 1, killReward: 1500, armorPen: 1 },
  bomb: { id: 'bomb', name: 'C4 Charge', slot: 'bomb', cls: 'Bomb', price: 0, team: 'T', speedMult: 1 },
};

export const GRENADE_IDS = ['flashbang', 'molotov', 'smoke', 'he'];
export const MAX_GRENADES = 4;

export const EQUIPMENT = {
  vest: { id: 'vest', name: 'Kevlar Vest', price: 650, team: 'any' },
  vesthelm: { id: 'vesthelm', name: 'Kevlar + Helmet', price: 1000, team: 'any' },
  kit: { id: 'kit', name: 'Defuse Kit', price: 400, team: 'CT' },
};

export const BUY_MENU = [
  { cat: 'Pistols', items: ['p9'] },
  { cat: 'Rifles', items: ['carbine'] },
  { cat: 'Gear', items: ['vest', 'vesthelm', 'kit'] },
  { cat: 'Utility', items: ['flashbang', 'smoke', 'he', 'molotov'] },
];

export const UTIL = {
  FLASH_MAX: 3.5,
  FLASH_RANGE: 32,
  SMOKE_DURATION: 18,
  SMOKE_RADIUS: 4.3,
  FIRE_DURATION: 7,
  FIRE_RADIUS: 3.2,
  FIRE_DPS: 40,
  HE_DAMAGE: 98,
  HE_RADIUS: 7,
  PUDDLE_DURATION: 8,
  PUDDLE_RADIUS: 1.4,
  BOMB_RADIUS: 22,
  BOMB_DAMAGE: 500,
};

export function itemInfo(id) {
  return WEAPONS[id] || EQUIPMENT[id];
}

export function lossBonus(streak) {
  return Math.min(ECON.LOSS_BASE + ECON.LOSS_INC * Math.max(0, streak - 1), ECON.LOSS_MAX);
}
