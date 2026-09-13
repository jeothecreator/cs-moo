// Shared game constants — imported by both the Node server and the browser client.

export const TICK_RATE = 60;
export const SNAPSHOT_RATE = 30;
export const INTERP_DELAY = 100; // ms
export const LAG_COMP_MAX = 1000; // ms of hitbox history kept on the server

export const TEAMS = {
  T: { id: 'T', name: 'Rogue Bulls', short: 'BULLS', color: '#e0a340' },
  CT: { id: 'CT', name: 'Dairy Guard', short: 'GUARD', color: '#5d9cec' },
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

// Placeable cow blocks.
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
export const DEFAULT_PRIMARY = 'milkyway';

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
  ak: pattern(30, (i) => [
    i < 8 ? 0.18 * Math.sin(i * 1.7) : 3.4 * Math.sin((i - 8) / 3.6) + 0.25 * Math.sin(i * 2.3),
    Math.min(i, 9) * 0.95 + Math.max(0, i - 9) * 0.1,
  ]),
  mooster: pattern(25, (i) => [
    i < 10 ? 0.12 * Math.sin(i * 1.3) : 1.9 * Math.sin((i - 10) / 4.5),
    Math.min(i, 10) * 0.66 + Math.max(0, i - 10) * 0.07,
  ]),
  milkyway: pattern(30, (i) => [0.9 * Math.sin(i * 0.8) + 0.3 * Math.sin(i * 2.1), Math.min(i, 12) * 0.45]),
  udder9: pattern(18, (i) => [0.35 * Math.sin(i * 1.9), Math.min(i * 1.1, 7)]),
  deag: pattern(7, (i) => [0.6 * Math.sin(i * 2.4), Math.min(i * 3.8, 12)]),
  pasteurizer: pattern(7, (i) => [0, Math.min(i * 2.5, 8)]),
  creaminator: pattern(5, (i) => [0, i * 4]),
  none: [[0, 0]],
};

export const WEAPONS = {
  hoof: {
    id: 'hoof', name: 'Hoof', slot: 'melee', cls: 'Knife', price: 0, team: 'any',
    damage: { head: 40, body: 40, leg: 40 }, altDamage: 65, armorPen: 0.85,
    rpm: 120, mag: 0, reserve: 0, reload: 0, auto: true, pellets: 1,
    spread: 0, moveSpread: 0, jumpSpread: 0, range: 1.9, falloff: 1,
    speedMult: 1.0, killReward: 1500, recoil: 'none', penetration: 0, deploy: 0.4,
  },
  udder9: {
    id: 'udder9', name: 'Udder-Nine', slot: 'secondary', cls: 'Pistol', price: 0, team: 'any',
    damage: { head: 104, body: 26, leg: 21 }, armorPen: 0.905,
    rpm: 500, mag: 18, reserve: 90, reload: 2.5, auto: false, pellets: 1,
    spread: 0.0045, moveSpread: 0.012, jumpSpread: 0.09, range: 120, falloff: 0.96,
    speedMult: 0.97, killReward: 300, recoil: 'udder9', penetration: 1, deploy: 0.6, recovery: 9,
  },
  deag: {
    id: 'deag', name: 'Deag-Bull', slot: 'secondary', cls: 'Pistol', price: 700, team: 'any',
    damage: { head: 150, body: 52, leg: 38 }, armorPen: 0.932,
    rpm: 267, mag: 7, reserve: 35, reload: 2.2, auto: false, pellets: 1,
    spread: 0.002, moveSpread: 0.032, jumpSpread: 0.1, range: 150, falloff: 0.97,
    speedMult: 0.93, killReward: 300, recoil: 'deag', penetration: 2, deploy: 0.8, recovery: 3.5,
  },
  milkyway: {
    id: 'milkyway', name: 'Milky Way', slot: 'primary', cls: 'SMG', price: 1050, team: 'any',
    damage: { head: 60, body: 20, leg: 16 }, armorPen: 0.575,
    rpm: 800, mag: 30, reserve: 100, reload: 2.6, auto: true, pellets: 1,
    spread: 0.006, moveSpread: 0.014, jumpSpread: 0.07, range: 80, falloff: 0.9,
    speedMult: 0.97, killReward: 600, recoil: 'milkyway', penetration: 1, deploy: 0.7, recovery: 14,
  },
  pasteurizer: {
    id: 'pasteurizer', name: 'Pasteurizer', slot: 'primary', cls: 'Shotgun', price: 2000, team: 'any',
    damage: { head: 60, body: 24, leg: 18 }, armorPen: 0.8,
    rpm: 240, mag: 7, reserve: 32, reload: 2.9, auto: true, pellets: 8,
    spread: 0.055, moveSpread: 0.02, jumpSpread: 0.08, range: 35, falloff: 0.72,
    speedMult: 0.9, killReward: 900, recoil: 'pasteurizer', penetration: 0, deploy: 0.9, recovery: 6, adsSpread: 0.8, shellReload: 0.5,
  },
  ak: {
    id: 'ak', name: 'AK-Moory', slot: 'primary', cls: 'Rifle', price: 2700, team: 'T',
    damage: { head: 143, body: 36, leg: 27 }, armorPen: 0.775,
    rpm: 600, mag: 30, reserve: 90, reload: 2.5, auto: true, pellets: 1,
    spread: 0.003, moveSpread: 0.045, jumpSpread: 0.12, range: 200, falloff: 0.98,
    speedMult: 0.86, killReward: 300, recoil: 'ak', penetration: 2, deploy: 1.0, recovery: 11,
  },
  mooster: {
    id: 'mooster', name: 'Mooster-4A1', slot: 'primary', cls: 'Rifle', price: 2900, team: 'CT',
    damage: { head: 120, body: 33, leg: 24 }, armorPen: 0.7,
    rpm: 600, mag: 25, reserve: 75, reload: 3.1, auto: true, pellets: 1,
    spread: 0.0025, moveSpread: 0.04, jumpSpread: 0.11, range: 200, falloff: 0.985,
    speedMult: 0.9, killReward: 300, recoil: 'mooster', penetration: 2, deploy: 1.0, recovery: 12, suppressed: true,
  },
  creaminator: {
    id: 'creaminator', name: 'The Creaminator', slot: 'primary', cls: 'Sniper', price: 4750, team: 'any',
    damage: { head: 300, body: 115, leg: 85 }, armorPen: 0.975,
    rpm: 41, mag: 5, reserve: 30, reload: 3.7, auto: false, pellets: 1,
    spread: 0.035, scopedSpread: 0.0003, moveSpread: 0.1, jumpSpread: 0.2, range: 300, falloff: 0.995,
    speedMult: 0.8, scopedSpeedMult: 0.6, killReward: 100, recoil: 'creaminator', penetration: 3, deploy: 1.2,
    recovery: 2, scope: [20], slick: true,
  },
  // Utilities
  butter: { id: 'butter', name: 'Butter Grenade', slot: 'grenade', cls: 'Grenade', price: 200, team: 'any', max: 2, speedMult: 1, fuse: 1.6 },
  molotov: { id: 'molotov', name: 'Cheese Molotov', slot: 'grenade', cls: 'Grenade', price: 400, team: 'any', max: 1, speedMult: 1, fuse: 2.0 },
  smoke: { id: 'smoke', name: 'Sour Milk Grenade', slot: 'grenade', cls: 'Grenade', price: 300, team: 'any', max: 1, speedMult: 1, fuse: 3.0 },
  he: { id: 'he', name: 'He-Cheese', slot: 'grenade', cls: 'Grenade', price: 300, team: 'any', max: 1, speedMult: 1, fuse: 1.6 },
  cowblock: { id: 'cowblock', name: 'Cow Block', slot: 'block', cls: 'Block', price: 0, team: 'any', speedMult: 1 },
  stomp: { id: 'stomp', name: 'Moo Stomp', slot: 'special', cls: 'Special', price: 0, team: 'any', speedMult: 1, killReward: 1500, armorPen: 1 },
  bomb: { id: 'bomb', name: 'Sour Milk Bomb', slot: 'bomb', cls: 'Bomb', price: 0, team: 'T', speedMult: 1 },
};

export const GRENADE_IDS = ['butter', 'molotov', 'smoke', 'he'];
export const MAX_GRENADES = 4;

export const EQUIPMENT = {
  vest: { id: 'vest', name: 'Leather Vest', price: 650, team: 'any' },
  vesthelm: { id: 'vesthelm', name: 'Kevlar + Helmet', price: 1000, team: 'any' },
  kit: { id: 'kit', name: 'Defuse Kit', price: 400, team: 'CT' },
};

export const BUY_MENU = [
  { cat: 'Pistols', items: ['udder9', 'deag'] },
  { cat: 'SMGs', items: ['milkyway'] },
  { cat: 'Heavy', items: ['pasteurizer'] },
  { cat: 'Rifles', items: ['ak', 'mooster', 'creaminator'] },
  { cat: 'Gear', items: ['vest', 'vesthelm', 'kit'] },
  { cat: 'Utility', items: ['butter', 'smoke', 'he', 'molotov'] },
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
