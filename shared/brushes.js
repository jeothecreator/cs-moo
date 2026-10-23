// Collision world: convex brushes (plane sets) or plain AABB boxes, bucketed in a uniform XZ grid.
// Every brush has `min`/`max` (its bounds); non-axial brushes also carry `planes` (flat
// [nx, ny, nz, d, ...], outward normals, solid where n·p < d). `clip` brushes stop players
// but not bullets (Source's playerclip); `pen` brushes can be shot through.

const CELL = 4;
// One counter for every index: matches on the same map share brush objects across separate
// indexes, so per-index stamps could collide and silently skip a brush.
let STAMP = 1;

/** Flat plane list for a brush: its own planes plus the six axial bevels of its bounds. */
export function brushPlanes(b) {
  const P = b._planes, mn = b.min, mx = b.max;
  // Boxes can move (obby platforms), so the cached bevels are checked against the live bounds.
  if (P) {
    const o = P.length - 24;
    if (P[o + 3] === -mn[0] && P[o + 7] === mx[0] && P[o + 11] === -mn[1] && P[o + 15] === mx[1] && P[o + 19] === -mn[2] && P[o + 23] === mx[2]) return P;
  }
  const axial = [-1, 0, 0, -mn[0], 1, 0, 0, mx[0], 0, -1, 0, -mn[1], 0, 1, 0, mx[1], 0, 0, -1, -mn[2], 0, 0, 1, mx[2]];
  // Bevels keep a box hull from catching on the corners of slanted brushes.
  b._planes = Float64Array.from(b.planes ? [...b.planes, ...axial] : axial);
  return b._planes;
}

export class BrushIndex {
  constructor(brushes) {
    this.cells = new Map();
    this.big = []; // brushes too large to bucket, and moving ones (always tested)
    for (const b of brushes) this.add(b);
  }

  key(i, j) { return (i + 32768) * 65536 + (j + 32768); }

  add(b) {
    b._q = 0;
    const i0 = Math.floor(b.min[0] / CELL), i1 = Math.floor(b.max[0] / CELL);
    const j0 = Math.floor(b.min[2] / CELL), j1 = Math.floor(b.max[2] / CELL);
    if (b.moving || (i1 - i0 + 1) * (j1 - j0 + 1) > 4096) { this.big.push(b); return; }
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = this.key(i, j);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(b);
      }
    }
  }

  remove(b) {
    const bi = this.big.indexOf(b);
    if (bi >= 0) { this.big.splice(bi, 1); return; }
    const i0 = Math.floor(b.min[0] / CELL), i1 = Math.floor(b.max[0] / CELL);
    const j0 = Math.floor(b.min[2] / CELL), j1 = Math.floor(b.max[2] / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = this.cells.get(this.key(i, j));
        const at = list ? list.indexOf(b) : -1;
        if (at >= 0) list.splice(at, 1);
      }
    }
  }

  /** Call fn(brush) once for every brush whose cell range overlaps the XZ rectangle. */
  query(minX, minZ, maxX, maxZ, fn) {
    const s = ++STAMP;
    for (const b of this.big) fn(b);
    const i0 = Math.floor(minX / CELL), i1 = Math.floor(maxX / CELL);
    const j0 = Math.floor(minZ / CELL), j1 = Math.floor(maxZ / CELL);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const list = this.cells.get(this.key(i, j));
        if (!list) continue;
        for (const b of list) if (b._q !== s) { b._q = s; fn(b); }
      }
    }
  }

  /**
   * Walk the cells a ray crosses (2D DDA), handing each new brush to fn. fn returns the best
   * distance found so far; the walk stops once that hit is nearer than the next cell boundary.
   */
  ray(o, d, maxDist, fn) {
    const s = ++STAMP;
    let best = maxDist;
    for (const b of this.big) best = Math.min(best, fn(b));
    let i = Math.floor(o[0] / CELL), j = Math.floor(o[2] / CELL);
    const stepI = d[0] > 0 ? 1 : -1, stepJ = d[2] > 0 ? 1 : -1;
    const tDI = Math.abs(d[0]) > 1e-12 ? CELL / Math.abs(d[0]) : Infinity;
    const tDJ = Math.abs(d[2]) > 1e-12 ? CELL / Math.abs(d[2]) : Infinity;
    let tI = Math.abs(d[0]) > 1e-12 ? ((d[0] > 0 ? (i + 1) * CELL - o[0] : o[0] - i * CELL) / Math.abs(d[0])) : Infinity;
    let tJ = Math.abs(d[2]) > 1e-12 ? ((d[2] > 0 ? (j + 1) * CELL - o[2] : o[2] - j * CELL) / Math.abs(d[2])) : Infinity;
    let t = 0;
    for (let guard = 0; guard < 4096 && t <= best; guard++) {
      const list = this.cells.get(this.key(i, j));
      if (list) for (const b of list) if (b._q !== s) { b._q = s; best = Math.min(best, fn(b)); }
      if (tI < tJ) { t = tI; tI += tDI; i += stepI; } else { t = tJ; tJ += tDJ; j += stepJ; }
      if (t > best) break;
    }
    return best;
  }
}

const indexes = new WeakMap();
/** The index for a brush array (built on first use, kept in sync by addBrush/removeBrush). */
export function indexOf(brushes) {
  let idx = indexes.get(brushes);
  if (!idx) { idx = new BrushIndex(brushes); indexes.set(brushes, idx); }
  return idx;
}
export function addBrush(brushes, b) { brushes.push(b); indexes.get(brushes)?.add(b); }
export function removeBrush(brushes, b) {
  const i = brushes.indexOf(b);
  if (i >= 0) brushes.splice(i, 1);
  indexes.get(brushes)?.remove(b);
}

/** Expand a compiled map module (tools/vmf2map.mjs) into brush objects. */
export function decodeBrushes(data) {
  const out = [];
  const st = data.stride, f = data.brushes, P = data.planes;
  for (let i = 0; i < f.length; i += st) {
    const flags = f[i + 7], ps = f[i + 8], pc = f[i + 9];
    out.push({
      min: [f[i], f[i + 1], f[i + 2]], max: [f[i + 3], f[i + 4], f[i + 5]],
      mat: data.mats[f[i + 6]], clip: !!(flags & 1), pen: !!(flags & 2),
      planes: ps >= 0 ? P.slice(ps * 4, (ps + pc) * 4) : null,
    });
  }
  return out;
}
