// Grid navigation for bots: 1m cells, 8-connected A* with string-pulled paths.
import { MAP } from '../shared/map.js';
// Note: MAP is a live binding — callers must have the right map active when constructing a Nav.
import { boxBlocked } from '../shared/physics.js';

const CELL = 1;

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
    this.minX = b.minX; this.minZ = b.minZ;
    this.w = Math.ceil((b.maxX - b.minX) / CELL);
    this.h = Math.ceil((b.maxZ - b.minZ) / CELL);
    this.walk = new Uint8Array(this.w * this.h);
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        const [x, z] = this.center(i, j);
        this.walk[j * this.w + i] = boxBlocked(x, 0.46, z, 0.5, 1.3) ? 0 : 1;
      }
    }
    this.g = new Float32Array(this.w * this.h);
    this.parent = new Int32Array(this.w * this.h);
    this.stamp = new Uint32Array(this.w * this.h);
    this.closed = new Uint32Array(this.w * this.h);
    this.gen = 1;
  }

  center(i, j) { return [this.minX + (i + 0.5) * CELL, this.minZ + (j + 0.5) * CELL]; }

  cell(x, z) {
    return [
      Math.max(0, Math.min(this.w - 1, Math.floor((x - this.minX) / CELL))),
      Math.max(0, Math.min(this.h - 1, Math.floor((z - this.minZ) / CELL))),
    ];
  }

  ok(i, j) { return i >= 0 && j >= 0 && i < this.w && j < this.h && this.walk[j * this.w + i] === 1; }

  nearestWalkable(i, j) {
    if (this.ok(i, j)) return [i, j];
    for (let r = 1; r < 12; r++) {
      for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        if (this.ok(i + di, j + dj)) return [i + di, j + dj];
      }
    }
    return [i, j];
  }

  walkableAt(x, z) { const [i, j] = this.cell(x, z); return this.ok(i, j); }

  randomNear(x, z, radius, tries = 20) {
    for (let k = 0; k < tries; k++) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * radius;
      const px = x + Math.cos(a) * r, pz = z + Math.sin(a) * r;
      if (this.walkableAt(px, pz)) return [px, pz];
    }
    const [i, j] = this.nearestWalkable(...this.cell(x, z));
    return this.center(i, j);
  }

  clear(ax, az, bx, bz) {
    const d = Math.hypot(bx - ax, bz - az);
    const steps = Math.ceil(d / 0.35);
    for (let s = 1; s < steps; s++) {
      const t = s / steps;
      if (!this.walkableAt(ax + (bx - ax) * t, az + (bz - az) * t)) return false;
    }
    return true;
  }

  findPath(sx, sz, gx, gz) {
    const [si, sj] = this.nearestWalkable(...this.cell(sx, sz));
    const [gi, gj] = this.nearestWalkable(...this.cell(gx, gz));
    const W = this.w;
    const start = sj * W + si, goal = gj * W + gi;
    const gen = ++this.gen;
    const heap = new Heap();
    this.g[start] = 0; this.stamp[start] = gen; this.parent[start] = -1;
    const hfn = (i, j) => {
      const dx = Math.abs(i - gi), dz = Math.abs(j - gj);
      return dx + dz + (Math.SQRT2 - 2) * Math.min(dx, dz);
    };
    heap.push(start, hfn(si, sj));
    let found = false, iter = 0;
    while (heap.size && iter++ < 20000) {
      const cur = heap.pop();
      if (this.closed[cur] === gen) continue;
      this.closed[cur] = gen;
      if (cur === goal) { found = true; break; }
      const ci = cur % W, cj = (cur / W) | 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const ni = ci + di, nj = cj + dj;
        if (!this.ok(ni, nj)) continue;
        if (di && dj && (!this.ok(ci + di, cj) || !this.ok(ci, cj + dj))) continue;
        const n = nj * W + ni;
        if (this.closed[n] === gen) continue;
        const ng = this.g[cur] + (di && dj ? Math.SQRT2 : 1);
        if (this.stamp[n] !== gen || ng < this.g[n]) {
          this.stamp[n] = gen; this.g[n] = ng; this.parent[n] = cur;
          heap.push(n, ng + hfn(ni, nj));
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let c = goal; c !== -1; c = this.parent[c]) cells.push(c);
    cells.reverse();
    const pts = cells.map((c) => this.center(c % W, (c / W) | 0));
    pts[pts.length - 1] = this.walkableAt(gx, gz) ? [gx, gz] : pts[pts.length - 1];
    // string pulling
    const out = [];
    let anchor = [sx, sz];
    let k = 0;
    while (k < pts.length) {
      let far = k;
      for (let m = pts.length - 1; m > k; m--) {
        if (this.clear(anchor[0], anchor[1], pts[m][0], pts[m][1])) { far = m; break; }
      }
      out.push(pts[far]);
      anchor = pts[far];
      k = far + 1;
    }
    return out;
  }
}

const navCache = new Map();
/** Nav grid for the currently active map (built once per map). */
export function getNav() {
  if (!navCache.has(MAP.name)) navCache.set(MAP.name, new Nav());
  return navCache.get(MAP.name);
}
