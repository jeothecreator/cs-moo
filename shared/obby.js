// Obby creator block catalogue + validation, shared by the browser editor and the server API.

export const OBBY_BLOCKS = [
  { id: 0, name: 'Turf', key: '1', color: '#6fae3f' },
  { id: 1, name: 'Crate', key: '2', color: '#b58a4f' },
  { id: 2, name: 'Sandbags', key: '3', color: '#e0c060' },
  { id: 3, name: 'Wood', key: '4', color: '#9c7a52' },
  { id: 4, name: 'Steel tank', key: '5', color: '#cfd8de' },
  { id: 5, name: 'Rotten planks · collapse', key: '6', color: '#f5c542' },
  { id: 6, name: 'Toxic sludge · resets', key: '7', color: '#86e05a' },
  { id: 7, name: 'Bounce pad', key: '8', color: '#f29bb5' },
  { id: 8, name: 'Ice · slippery', key: '9', color: '#f7e7a0' },
  { id: 9, name: 'Checkpoint', key: '0', color: '#e8e2d4' },
  { id: 10, name: 'Start', key: '-', color: '#5d9cec' },
  { id: 11, name: 'Finish', key: '=', color: '#f2c14e' },
];

export const BLOCK = {
  TURF: 0, CRATE: 1, SANDBAG: 2, WOOD: 3, TANK: 4, ROTTEN: 5, TOXIC: 6, PAD: 7, ICE: 8, CHECK: 9, START: 10, FINISH: 11,
};

export const OBBY_LIMITS = { MAX_BLOCKS: 3000, XZ: 60, Y: 40, NAME: 32 };

/** Longest distance (metres) the server accepts for the official course leaderboard. */
export const OBBY_MAX_DISTANCE = 1000;

/** Validates and de-duplicates a block list of [x, y, z, type]. */
export function validateObbyBlocks(input) {
  if (!Array.isArray(input) || !input.length) return { ok: false, error: 'Place some blocks first' };
  if (input.length > OBBY_LIMITS.MAX_BLOCKS) return { ok: false, error: `Too many blocks (max ${OBBY_LIMITS.MAX_BLOCKS})` };
  const seen = new Set();
  const blocks = [];
  let starts = 0;
  let finishes = 0;
  for (const b of input) {
    if (!Array.isArray(b) || b.length !== 4 || !b.every(Number.isInteger)) return { ok: false, error: 'Invalid block data' };
    const [x, y, z, t] = b;
    if (Math.abs(x) > OBBY_LIMITS.XZ || Math.abs(z) > OBBY_LIMITS.XZ || y < 0 || y > OBBY_LIMITS.Y) return { ok: false, error: 'A block is outside the build area' };
    if (t < 0 || t >= OBBY_BLOCKS.length) return { ok: false, error: 'Unknown block type' };
    const key = `${x},${y},${z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (t === BLOCK.START) starts++;
    if (t === BLOCK.FINISH) finishes++;
    blocks.push([x, y, z, t]);
  }
  if (starts === 0) return { ok: false, error: 'Add a Start block (key -)' };
  if (starts > 1) return { ok: false, error: 'Only one Start block is allowed' };
  if (finishes === 0) return { ok: false, error: 'Add at least one Finish block (key =)' };
  return { ok: true, blocks };
}
