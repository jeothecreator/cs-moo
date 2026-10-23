// Bot navigation over a layered height grid. Every 1 m cell can hold several walkable floors
// (ground, catwalk, rooftop); neighbouring floors connect when a body can walk or step between
// them, checked with the same hull traces the player physics uses. 8-connected A* with
// string-pulled paths. Floors unreachable from any spawn are dropped.
import { MAP } from '../shared/map.js';
// Note: MAP is a live binding — callers must have the right map active when constructing a Nav.
import { boxBlocked, trace } from '../shared/physics.js';
import { PLAYER } from '../shared/constants.js';

const CELL = 1;
const STEP = 0.55;          // max height change between neighbouring floors
const PROBE_R = 0.3;
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

class Heap {
  constructor() { this.items = []; }
  push(node, f) {
    const a = this.items;
    a.push([f, node]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top[1];
  }
  get size() { return this.items.length; }
}

export class Nav {
  constructor() {
    const b = MAP.bounds;
    this.boxes = MAP.boxes;
    this.minX = b.minX; this.minZ = b.minZ;
    this.w = Math.ceil((b.maxX - b.minX) / CELL);
    this.h = Math.ceil((b.maxZ - b.minZ) / CELL);
    this.buildFloors();
    this.edges = new Int32Array(this.count * 8).fill(-2); // -2 unknown, -1 none, else node
    this.prune();
    const n = this.count;
    this.g = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.gen = 1;
  }

  // ─── grid ──────────────────────────────────────────────────
  center(i, j) { return [this.minX + (i + 0.5) * CELL, this.minZ + (j + 0.5) * CELL]; }
  cell(x, z) {
    return [Math.max(0, Math.min(this.w - 1, Math.floor((x - this.minX) / CELL))), Math.max(0, Math.min(this.h - 1, Math.floor((z - this.minZ) / CELL)))];
  }

  /** Scan each cell top-down for floors a standing player fits on. */
  buildFloors() {
    const compiled = !!this.boxes.noGround;
    const top = compiled ? (MAP.ceilingY ?? 40) : (MAP.wallH || 12) + 2;
    const bottom = compiled ? (MAP.floorY ?? -20) - 1 : -0.5;
    const xs = [], ys = [], zs = [];
    this.cellStart = new Int32Array(this.w * this.h + 1);
    const lists = [];
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        const [x, z] = this.center(i, j);
        const found = [];
        let y = top;
        for (let layer = 0; layer < 8 && y > bottom; layer++) {
          const tr = trace([x, y, z], [x, bottom, z], PROBE_R, 0.05, PROBE_R, this.boxes);
          if (tr.allSolid) { y -= 0.3; continue; }
          if (tr.fraction >= 1) break;
          const fy = tr.end[1] - 0.05;
          if (tr.normal && tr.normal[1] >= 0.7 && !boxBlocked(x, fy + 0.03, z, PROBE_R, PLAYER.HEIGHT - 0.05, this.boxes)) found.push(fy + 0.02);
          // continue beneath this surface: step down through the solid below it
          y = fy - 0.15;
          let guard = 0;
          while (y > bottom && guard++ < 200 && boxBlocked(x, y - 0.1, z, 0.05, 0.1, this.boxes)) y -= 0.3;
        }
        lists.push(found);
      }
    }
    let k = 0;
    for (let c = 0; c < lists.length; c++) {
      this.cellStart[c] = k;
      for (const fy of lists[c]) {
        const [x, z] = this.center(c % this.w, (c / this.w) | 0);
        xs.push(x); ys.push(fy); zs.push(z);
        k++;
      }
    }
    this.cellStart[lists.length] = k;
    this.count = k;
    this.nx = Float32Array.from(xs); this.ny = Float32Array.from(ys); this.nz = Float32Array.from(zs);
    this.nodeCell = new Int32Array(k);
    for (let c = 0; c < lists.length; c++) for (let n = this.cellStart[c]; n < this.cellStart[c + 1]; n++) this.nodeCell[n] = c;
  }

  nodesIn(i, j) {
    if (i < 0 || j < 0 || i >= this.w || j >= this.h) return [0, 0];
    const c = j * this.w + i;
    return [this.cellStart[c], this.cellStart[c + 1]];
  }

  /** Can a body walk from node a straight to node b (neighbours or a short skip)? */
  passable(a, b) {
    const ya = this.ny[a], yb = this.ny[b];
    if (Math.abs(ya - yb) > STEP) return false;
    const base = Math.max(ya, yb) + 0.5, hy = 0.55;
    const tr = trace([this.nx[a], base + hy, this.nz[a]], [this.nx[b], base + hy, this.nz[b]], PROBE_R, hy, PROBE_R, this.boxes);
    return !tr.startSolid && tr.fraction >= 1;
  }

  neighbour(a, k) {
    const e = this.edges[a * 8 + k];
    if (e !== -2) return e;
    const c = this.nodeCell[a];
    const i = c % this.w, j = (c / this.w) | 0;
    const [di, dj] = DIRS[k];
    let best = -1;
    if (k >= 4) {
      // no diagonal corner-cutting: both orthogonal neighbours must be open at this height
      const ok1 = this.neighbour(a, di > 0 ? 0 : 1), ok2 = this.neighbour(a, dj > 0 ? 2 : 3);
      if (ok1 < 0 || ok2 < 0) { this.edges[a * 8 + k] = -1; return -1; }
    }
    const [s, e2] = this.nodesIn(i + di, j + dj);
    let bestDy = Infinity;
    for (let n = s; n < e2; n++) {
      const dy = Math.abs(this.ny[n] - this.ny[a]);
      if (dy < bestDy && dy <= STEP) { bestDy = dy; best = n; }
    }
    if (best >= 0 && !this.passable(a, best)) best = -1;
    this.edges[a * 8 + k] = best;
    return best;
  }

  /** Keep only floors reachable from a spawn (crate tops, roofs and sealed rooms drop out). */
  prune() {
    const seen = new Uint8Array(this.count);
    const queue = [];
    const seeds = [...(MAP.spawns.T || []), ...(MAP.spawns.CT || []), ...(MAP.spawns.FFA || [])];
    for (const s of seeds) {
      const n = this.nearestNode(s[0], s[1], s[2] ?? 0, 3);
      if (n >= 0 && !seen[n]) { seen[n] = 1; queue.push(n); }
    }
    for (let q = 0; q < queue.length; q++) {
      const a = queue[q];
      for (let k = 0; k < 8; k++) {
        const b = this.neighbour(a, k);
        if (b >= 0 && !seen[b]) { seen[b] = 1; queue.push(b); }
      }
    }
    this.reach = seen;
    this.reachable = queue.length;
  }

  // ─── queries ───────────────────────────────────────────────
  /** Closest reachable floor to (x, y, z), searching up to `radius` cells out. */
  nearestNode(x, z, y = null, radius = 6) {
    const [ci, cj] = this.cell(x, z);
    let best = -1, bd = Infinity;
    for (let r = 0; r <= radius; r++) {
      for (let j = cj - r; j <= cj + r; j++) {
        for (let i = ci - r; i <= ci + r; i++) {
          if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
          const [s, e] = this.nodesIn(i, j);
          for (let n = s; n < e; n++) {
            if (this.reach && !this.reach[n]) continue;
            const dy = y === null ? this.ny[n] * 0.01 : Math.abs(this.ny[n] - y) * 2;
            const d = Math.hypot(this.nx[n] - x, this.nz[n] - z) + dy;
            if (d < bd) { bd = d; best = n; }
          }
        }
      }
      if (best >= 0 && r >= 1) break;
    }
    return best;
  }

  walkableAt(x, z) { return this.nearestNode(x, z, null, 0) >= 0; }

  point(n) { return [this.nx[n], this.nz[n], this.ny[n]]; }

  /** A random reachable floor within r of (x, z), near height y when given. Returns [x, z, y]. */
  randomNear(x, z, r = 4, y = null) {
    for (let k = 0; k < 30; k++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
      const n = this.nearestNode(x + Math.cos(a) * d, z + Math.sin(a) * d, y, 0);
      if (n >= 0 && (y === null || Math.abs(this.ny[n] - y) < 2.5)) return this.point(n);
    }
    const n = this.nearestNode(x, z, y, 8);
    return n >= 0 ? this.point(n) : [x, z, y ?? 0];
  }

  /** Path as [[x, z, y], ...] from (sx, sy, sz) to (gx, gy, gz); heights optional. */
  findPath(sx, sz, gx, gz, sy = null, gy = null) {
    const start = this.nearestNode(sx, sz, sy);
    const goal = this.nearestNode(gx, gz, gy);
    if (start < 0 || goal < 0) return null;
    const gen = ++this.gen;
    const open = new Heap();
    const H = (n) => Math.hypot(this.nx[n] - this.nx[goal], this.nz[n] - this.nz[goal], this.ny[n] - this.ny[goal]);
    this.g[start] = 0; this.stamp[start] = gen; this.parent[start] = -1;
    open.push(start, H(start));
    let found = false, expanded = 0;
    while (open.size && expanded < 60000) {
      const a = open.pop();
      if (this.closed[a] === gen) continue;
      this.closed[a] = gen;
      expanded++;
      if (a === goal) { found = true; break; }
      for (let k = 0; k < 8; k++) {
        const b = this.neighbour(a, k);
        if (b < 0 || this.closed[b] === gen) continue;
        const cost = this.g[a] + (k < 4 ? 1 : 1.4142) + Math.abs(this.ny[b] - this.ny[a]) * 0.5;
        if (this.stamp[b] !== gen || cost < this.g[b]) {
          this.stamp[b] = gen; this.g[b] = cost; this.parent[b] = a;
          open.push(b, cost + H(b));
        }
      }
    }
    if (!found) return null;
    const nodes = [];
    for (let n = goal; n !== -1; n = this.parent[n]) nodes.push(n);
    nodes.reverse();
    return this.smooth(nodes).map((n) => this.point(n));
  }

  /** Drop waypoints a body can walk straight past (flat, unobstructed, floor all the way). */
  smooth(nodes) {
    if (nodes.length < 3) return nodes;
    const out = [nodes[0]];
    let anchor = 0;
    for (let i = 2; i < nodes.length; i++) {
      if (!this.straight(nodes[anchor], nodes[i])) {
        out.push(nodes[i - 1]);
        anchor = i - 1;
      }
    }
    out.push(nodes[nodes.length - 1]);
    return out;
  }

  straight(a, b) {
    if (Math.abs(this.ny[a] - this.ny[b]) > 0.3) return false;
    const dx = this.nx[b] - this.nx[a], dz = this.nz[b] - this.nz[a];
    const len = Math.hypot(dx, dz);
    for (let t = 0.5; t < len; t += 0.5) {
      const n = this.nearestNode(this.nx[a] + dx * t / len, this.nz[a] + dz * t / len, this.ny[a], 0);
      if (n < 0 || Math.abs(this.ny[n] - this.ny[a]) > 0.3) return false;
    }
    return this.passable(a, b);
  }

  // ─── auto-placed bot spots for compiled maps ───────────────
  /** Entries (approach points) and hold spots for each site, plus FFA roam points. */
  autoSpots() {
    const spots = { entries: {}, holdSpots: {}, roam: [] };
    const avg = (list) => list.length ? [list.reduce((s, p) => s + p[0], 0) / list.length, list.reduce((s, p) => s + p[1], 0) / list.length, list.reduce((s, p) => s + (p[2] ?? 0), 0) / list.length] : [0, 0, 0];
    const tSpawn = avg(MAP.spawns.T || []), ctSpawn = avg(MAP.spawns.CT || []);
    const mid = [(tSpawn[0] + ctSpawn[0]) / 2, (tSpawn[1] + ctSpawn[1]) / 2, (tSpawn[2] + ctSpawn[2]) / 2];
    for (const [name, s] of Object.entries(MAP.sites || {})) {
      const c = [s.center[0], s.center[1], s.floor ?? null];
      const inSite = (p) => p[0] > s.minX - 4 && p[0] < s.maxX + 4 && p[1] > s.minZ - 4 && p[1] < s.maxZ + 4;
      const entryFrom = (from) => {
        const path = this.findPath(from[0], from[1], c[0], c[1], from[2], c[2]);
        if (!path) return null;
        const dense = [];
        for (let i = 1; i < path.length; i++) {
          const a = path[i - 1], b = path[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]);
          for (let t = 0; t < len; t += 1) dense.push([a[0] + (b[0] - a[0]) * t / len, a[1] + (b[1] - a[1]) * t / len, a[2] + (b[2] - a[2]) * t / len]);
        }
        const k = dense.findIndex(inSite);
        return k > 0 ? dense[Math.max(0, k - 5)] : null;
      };
      const e1 = entryFrom(tSpawn), e2 = entryFrom(mid);
      spots.entries[name] = [e1, e2 || e1].filter(Boolean);
      if (!spots.entries[name].length) spots.entries[name] = [this.randomNear(c[0], c[1], 6, c[2])];
      // Hold spots: inside the site, 7–20 m from an entry, with sight of it, spread apart.
      const holds = [];
      for (let tries = 0; tries < 400 && holds.length < 3; tries++) {
        const p = this.randomNear(c[0] + (Math.random() - 0.5) * (s.maxX - s.minX + 8), c[1] + (Math.random() - 0.5) * (s.maxZ - s.minZ + 8), 1, c[2]);
        const look = spots.entries[name][holds.length % spots.entries[name].length];
        const d = Math.hypot(p[0] - look[0], p[1] - look[1]);
        if (d < 7 || d > 22 || holds.some((h) => Math.hypot(h.p[0] - p[0], h.p[1] - p[1]) < 4)) continue;
        if (!this.losClear(p, look)) continue;
        holds.push({ p, look });
      }
      while (holds.length < 2) holds.push({ p: this.randomNear(c[0], c[1], 5, c[2]), look: spots.entries[name][0] });
      spots.holdSpots[name] = holds;
    }
    spots.holdSpots.mid = [0, 1].map(() => ({ p: this.randomNear(mid[0], mid[1], 10, mid[2]), look: [tSpawn[0], tSpawn[1], tSpawn[2]] }));
    spots.roam = (MAP.spawns.FFA || []).map((s) => [s[0], s[1], s[2]]);
    for (let i = 0; i < 24; i++) {
      const n = Math.floor(Math.random() * this.count);
      if (this.reach[n]) spots.roam.push(this.point(n));
    }
    return spots;
  }

  losClear(a, b) {
    const ay = (a[2] ?? 0) + PLAYER.EYE, by = (b[2] ?? 0) + PLAYER.EYE;
    const dx = b[0] - a[0], dy = by - ay, dz = b[1] - a[1], len = Math.hypot(dx, dy, dz) || 1;
    const tr = trace([a[0], ay, a[1]], [b[0], by, b[1]], 0, 0, 0, this.boxes, true);
    return tr.fraction * len >= len - 0.5;
  }
}

const navCache = new Map();
/** Nav grid for the currently active map (built once per map). */
export function getNav() {
  if (!navCache.has(MAP.name)) navCache.set(MAP.name, new Nav());
  return navCache.get(MAP.name);
}
