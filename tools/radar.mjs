#!/usr/bin/env node
// Render a CS-style overview ("radar") image for a map, like the ones Valve ships with each map.
// Only floors a player can actually reach from a spawn are drawn, so roofs, the inside of walls
// and the space beyond the playable area stay transparent. Brightness follows floor height.
//
// usage: node tools/radar.mjs <map_name>
// output: client/assets/maps/<map_name>_radar.png covering MAP.bounds at RADAR_PX pixels per metre
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { setActiveMap, RADAR_PX } from '../shared/map.js';
import { trace, boxBlocked } from '../shared/physics.js';
import { Nav } from '../server/nav.js';

const name = process.argv[2];
if (!name) { console.error('usage: node tools/radar.mjs <map_name>'); process.exit(1); }
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const MAP = setActiveMap(name);
if (MAP.name !== name) { console.error(`unknown map ${name}`); process.exit(1); }

const t0 = Date.now();
const nav = new Nav();
console.log(`nav: ${nav.reachable} reachable floors (${Date.now() - t0} ms)`);

// ─── floor scan ───────────────────────────────────────────────
const B = MAP.bounds, PX = RADAR_PX;
const W = Math.round((B.maxX - B.minX) * PX), H = Math.round((B.maxZ - B.minZ) * PX);
const top = MAP.ceilingY ?? 40, bottom = (MAP.floorY ?? -20) - 1;
const height = new Float32Array(W * H).fill(NaN);

/** Is there a reachable nav floor within a cell of (x, z) at about this height? */
function playable(x, z, y) {
  const [ci, cj] = nav.cell(x, z);
  for (let j = cj - 1; j <= cj + 1; j++) {
    for (let i = ci - 1; i <= ci + 1; i++) {
      const [s, e] = nav.nodesIn(i, j);
      for (let n = s; n < e; n++) {
        if (!nav.reach[n]) continue;
        if (Math.abs(nav.ny[n] - y) < 0.75 && Math.hypot(nav.nx[n] - x, nav.nz[n] - z) < 1.2) return true;
      }
    }
  }
  return false;
}

for (let py = 0; py < H; py++) {
  for (let px = 0; px < W; px++) {
    const x = B.minX + (px + 0.5) / PX, z = B.minZ + (py + 0.5) / PX;
    let y = top;
    for (let layer = 0; layer < 10 && y > bottom; layer++) {
      const tr = trace([x, y, z], [x, bottom, z], 0.04, 0.02, 0.04, MAP.boxes);
      if (tr.allSolid) { y -= 0.25; continue; }
      if (tr.fraction >= 1) break;
      const fy = tr.end[1] - 0.02;
      if (tr.normal && tr.normal[1] >= 0.5 && playable(x, z, fy)) { height[py * W + px] = fy; break; }
      y = fy - 0.1;
      let guard = 0;
      while (y > bottom && guard++ < 400 && boxBlocked(x, y - 0.05, z, 0.02, 0.05, MAP.boxes)) y -= 0.25;
    }
  }
}
console.log(`scan: ${W}×${H} px (${Date.now() - t0} ms)`);

// ─── shade ────────────────────────────────────────────────────
// Height range of the playable floors (robust to a few outliers).
const hs = [...height].filter((v) => !Number.isNaN(v)).sort((a, b) => a - b);
const lo = hs[Math.floor(hs.length * 0.02)], hi = hs[Math.floor(hs.length * 0.98)];
const rgba = Buffer.alloc(W * H * 4);
const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? NaN : height[y * W + x]);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const h = at(x, y);
    const o = (y * W + x) * 4;
    if (Number.isNaN(h)) {
      // Walls and props: a dark rim where they meet the floor, transparent elsewhere.
      let near = false;
      for (let k = -2; k <= 2 && !near; k++) for (let m = -2; m <= 2 && !near; m++) if (!Number.isNaN(at(x + k, y + m))) near = true;
      if (near) { rgba[o] = 18; rgba[o + 1] = 20; rgba[o + 2] = 24; rgba[o + 3] = 235; }
      continue;
    }
    const t = Math.max(0, Math.min(1, (h - lo) / Math.max(0.5, hi - lo)));
    // Steps in height draw a soft line, like contour shading on an official overview.
    let edge = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = at(x + dx, y + dy);
      if (!Number.isNaN(n) && Math.abs(n - h) > 0.3) edge = Math.max(edge, n > h ? 1 : 0.5);
    }
    const base = [64 + t * 112, 70 + t * 108, 78 + t * 100];
    const shade = edge ? 0.62 : 1;
    rgba[o] = base[0] * shade; rgba[o + 1] = base[1] * shade; rgba[o + 2] = base[2] * shade; rgba[o + 3] = 240;
  }
}

// ─── PNG ──────────────────────────────────────────────────────
function png(w, h, data) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) data.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    const td = Buffer.concat([Buffer.from(type), body]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(zlib.crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}
const out = path.join(ROOT, `client/assets/maps/${name}_radar.png`);
writeFileSync(out, png(W, H, rgba));
console.log(`radar: heights ${lo.toFixed(2)}…${hi.toFixed(2)} m → ${out} (${Date.now() - t0} ms)`);
