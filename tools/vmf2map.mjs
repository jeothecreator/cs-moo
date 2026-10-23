#!/usr/bin/env node
// Compile a Hammer .vmf into FRONTLINE map data:
//   shared/maps/<name>.js            collision brushes, spawns, sites, buy zones, ladders, sun
//   client/assets/maps/<name>.glb    render geometry, one primitive per surface family
//
// usage: node tools/vmf2map.mjs <file.vmf> <map_name> [--title Cache]
//
// Units: Hammer units × 0.0254 = metres (a CS player is 72 units ≈ 1.83 m, matching ours).
// Axes:  Hammer (x east, y north, z up) → ours (x, z, -y), a proper rotation so windings survive.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { parseVMF, brushFaces, parsePoints, planeFrom, vec } from './vmf.mjs';

const [file, name, ...rest] = process.argv.slice(2);
if (!file || !name) { console.error('usage: node tools/vmf2map.mjs <file.vmf> <map_name> [--title T]'); process.exit(1); }
const title = rest[rest.indexOf('--title') + 1] || name;
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const S = 0.0254;

// ─── surface families ─────────────────────────────────────────
// First match wins. `null` = never rendered (tool, blend or decal-only brushes).
const FAMILIES = [
  [/^tools\/toolsblack|cs_italy\/black|halflife\/black|\/black$/, 'black'],
  [/^tools\//, null],
  // Sky cards, tree-line cutouts and decal sheets: drawn by the skyline dressing instead (or not at all).
  [/^decals\/|^overlays\/|_decal|decal_|road_marking|street_overlay|bombsite|graffiti|sprites\/|effects\/|cobweb|darkersky|spawndarker|noscope|wires|^0$|treeline|miltree|nature\//, null],
  [/cautionstripe|hazard_stripe/, 'caution'],
  [/hr_conc|conc_pillar|conc_trim/, 'concrete'],
  [/glass|window|transparent|unbreakable|blinds/, 'glass'],
  [/container_red|metal_plate_wall_01_red/, 'containerRed'],
  [/container_blue|plate_wall_01_blue|bluegrating/, 'containerBlue'],
  [/rollup_door|nukdoors|metaldoor|metal_door|door_metal/, 'rollup'],
  [/ibeampillarred|recolorbeam|ibeam_01_color/, 'redBeam'],
  [/darkengrat|darkergrat/, 'floorPlate'],
  // Cache's tinted variants ("darker…", "…shift") of trims, bases and walls.
  [/darkertrim|trimdarken|darkerbase|concretedarker|sidedarker|darkerduct|contraster/, 'trimDark'],
  [/whitetile|whitegrass|blendtile|cachewhitetilegrass/, 'tile'],
  [/blacktop|asphalt|road|street|crossing|parking|crosswalk/, 'asphalt'],
  [/sand|gravel|dirt|rubble|trash|blend_grass/, 'dirt'],
  [/crate/, 'crate'],
  [/plywood|wood|barn|target/, 'wood'],
  [/tela|tarp/, 'tarp'],
  [/roof|corrugated/, 'roof'],
  [/metalfloor|grat|steps|escalator|stair|nukfloor|prodgrate|platescheap|cacheplate|metal_plate_01/, 'floorPlate'],
  [/rust/, 'rust'],
  [/ibeam|beam|truss|darkmetal|trim|edge/, 'beam'],
  [/brick|bhallswall|cachebackbricks/, 'brick'],
  [/ceiling|recoloration|coloration/, 'ceiling'],
  [/insulation|plaster|white/, 'plaster'],
  [/skybox_wall|apartment_block|warehouse_f|warehouse_front/, 'facade'],
  [/conc|cement|pillar|subzero|sidewalk|testconcrete|newconc|baggage/, 'concrete'],
  [/metal|panel|duct|vent|fence|rail|gate|milwall|milroof|hrmetal|fan|sign|cover|hurg|seasonwall|propshift|detailadd|sunroom|midwindow|base/, 'panel'],
];
const familyOf = (mat) => {
  const m = mat.toLowerCase();
  for (const [re, fam] of FAMILIES) if (re.test(m)) return fam;
  return 'concrete';
};
const PENETRABLE = new Set(['wood', 'crate', 'glass', 'tarp']);
const CLIP = /^tools\/(toolsclip|toolsplayerclip)$/;
const NOCOLLIDE = /^tools\/(toolstrigger|toolsareaportal|toolsoccluder|toolshint|toolsskip|toolsskybox|toolsnpcclip|toolsblocklight|toolsfog)/;

// ─── load ─────────────────────────────────────────────────────
const root = parseVMF(readFileSync(file, 'utf8'));
const world = root.children.find((c) => c.key === 'world');
const ents = root.children.filter((c) => c.key === 'entity');
const solidsOf = (n) => n.children.filter((c) => c.key === 'solid');
const origin = (e) => e.props.origin.split(/\s+/).map(Number);
const byClass = (cls) => ents.filter((e) => e.props.classname === cls);

// Playable region: everything around the spawns, sites and buy zones (drops the 3D skybox).
const keyPts = [...byClass('info_player_terrorist'), ...byClass('info_player_counterterrorist')].map(origin);
const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
for (const p of keyPts) for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i]); hi[i] = Math.max(hi[i], p[i]); }
const REGION = { min: [lo[0] - 3200, lo[1] - 3200, lo[2] - 1500], max: [hi[0] + 3200, hi[1] + 3200, hi[2] + 3500] };
const inRegion = (p) => p[0] > REGION.min[0] && p[0] < REGION.max[0] && p[1] > REGION.min[1] && p[1] < REGION.max[1] && p[2] > REGION.min[2] && p[2] < REGION.max[2];

const cx = Math.round((lo[0] + hi[0]) / 2), cy = Math.round((lo[1] + hi[1]) / 2);
const z0 = Math.round(Math.min(...keyPts.map((p) => p[2])));
const toW = (p) => [(p[0] - cx) * S, (p[2] - z0) * S, -(p[1] - cy) * S];
const nToW = (n) => [n[0], n[2], -n[1]];
const planeToW = (pl) => {
  const n = nToW(pl.n);
  return [n[0], n[1], n[2], (pl.d - pl.n[0] * cx - pl.n[1] * cy - pl.n[2] * z0) * S];
};
const r4 = (x) => Math.round(x * 1e4) / 1e4;

// ─── geometry accumulators ────────────────────────────────────
const render = new Map(); // family → { pos, nor, uv, idx }
const bucket = (fam) => {
  if (!render.has(fam)) render.set(fam, { pos: [], nor: [], uv: [], idx: [] });
  return render.get(fam);
};
const brushes = []; // { min, max, mat, clip, planes? }
const ladders = [], buyZones = {}, sites = [];
let skipped = 0, prisms = 0, dispFlat = 0;

function axisUV(side, p) {
  const ax = (s) => {
    const m = /\[([^\]]+)\]\s*([-\d.e]+)/.exec(s || '');
    if (!m) return null;
    const a = m[1].trim().split(/\s+/).map(Number);
    return { v: [a[0], a[1], a[2]], off: a[3] || 0, scale: Number(m[2]) || 0.25 };
  };
  const u = ax(side.props.uaxis), v = ax(side.props.vaxis);
  if (!u || !v) return [0, 0];
  return [(vec.dot(p, u.v) / u.scale + u.off) / 512, (vec.dot(p, v.v) / v.scale + v.off) / 512];
}

function emitPolygon(fam, poly, n, side) {
  const b = bucket(fam);
  const base = b.pos.length / 3;
  const wn = nToW(n);
  for (const p of poly) {
    b.pos.push(...toW(p).map(r4));
    b.nor.push(...wn.map(r4));
    const uv = axisUV(side, p);
    b.uv.push(r4(uv[0]), r4(1 - uv[1]));
  }
  for (let i = 1; i < poly.length - 1; i++) b.idx.push(base, base + i, base + i + 1);
}

function polyArea(poly) {
  let a = [0, 0, 0];
  for (let i = 1; i < poly.length - 1; i++) a = a.map((x, k) => x + vec.cross(vec.sub(poly[i], poly[0]), vec.sub(poly[i + 1], poly[0]))[k]);
  return Math.hypot(...a) / 2;
}

// Displacement grid, laid out like VBSP (row r runs from the start corner along the first edge).
function quadCorners(poly) {
  const out = [];
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const prev = poly[(i + n - 1) % n], here = poly[i], next = poly[(i + 1) % n];
    const a = vec.sub(here, prev), b = vec.sub(next, here);
    if (Math.hypot(...a) < 0.1) continue;
    if (Math.hypot(...vec.cross(vec.norm(a), vec.norm(b))) < 1e-3) continue;
    out.push(here);
  }
  return out.length === 4 ? out : null;
}
const nums = (s) => (s || '').trim().split(/\s+/).filter(Boolean).map(Number);
function buildDisp(face, info) {
  const corners = quadCorners(face.poly);
  if (!corners) return null;
  const power = Number(info.props.power) || 3, size = (1 << power) + 1;
  const start = nums(info.props.startposition.replace(/[[\]]/g, ' '));
  let si = 0, best = Infinity;
  corners.forEach((c, i) => { const d = Math.hypot(...vec.sub(c, start)); if (d < best) { best = d; si = i; } });
  const p = [0, 1, 2, 3].map((k) => corners[(si + k) % 4]);
  const block = (k) => info.children.find((c) => c.key === k);
  const rowVals = (k, w) => {
    const blk = block(k);
    const out = new Array(size * size * w).fill(0);
    if (!blk) return out;
    for (let r = 0; r < size; r++) nums(blk.props[`row${r}`]).slice(0, size * w).forEach((v, i) => { out[r * size * w + i] = v; });
    return out;
  };
  const normals = rowVals('normals', 3), dist = rowVals('distances', 1), offs = rowVals('offsets', 3);
  const elev = Number(info.props.elevation) || 0;
  const fn = face.plane.n;
  const lerp = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const pos = [], base = [];
  let dev = 0;
  for (let i = 0; i < size; i++) {
    const rs = lerp(p[0], p[1], i / (size - 1)), re = lerp(p[3], p[2], i / (size - 1));
    for (let j = 0; j < size; j++) {
      const at = j * size + i;
      const b0 = lerp(rs, re, j / (size - 1));
      const v = [
        b0[0] + normals[at * 3] * dist[at] + offs[at * 3] + fn[0] * elev,
        b0[1] + normals[at * 3 + 1] * dist[at] + offs[at * 3 + 1] + fn[1] * elev,
        b0[2] + normals[at * 3 + 2] * dist[at] + offs[at * 3 + 2] + fn[2] * elev,
      ];
      dev = Math.max(dev, Math.abs(vec.dot(vec.sub(v, b0), fn)));
      base.push(b0); pos.push(v);
    }
  }
  const tris = [];
  for (let i = 0; i < size - 1; i++) {
    for (let j = 0; j < size - 1; j++) {
      const a = i * size + j, b = a + 1, c = a + size, d = c + 1;
      const pair = (i + j) % 2 === 0 ? [[a, b, d], [a, d, c]] : [[a, b, c], [b, d, c]];
      for (const t of pair) {
        const n = vec.cross(vec.sub(pos[t[1]], pos[t[0]]), vec.sub(pos[t[2]], pos[t[0]]));
        tris.push(vec.dot(n, fn) >= 0 ? t : [t[0], t[2], t[1]]);
      }
    }
  }
  return { pos, base, tris, dev, fn };
}

function emitDisp(fam, disp, side) {
  const b = bucket(fam);
  const start = b.pos.length / 3;
  const vn = disp.pos.map(() => [0, 0, 0]);
  for (const [a, c, d] of disp.tris) {
    const n = vec.cross(vec.sub(disp.pos[c], disp.pos[a]), vec.sub(disp.pos[d], disp.pos[a]));
    for (const k of [a, c, d]) vn[k] = vn[k].map((x, i) => x + n[i]);
  }
  disp.pos.forEach((p, i) => {
    b.pos.push(...toW(p).map(r4));
    b.nor.push(...nToW(vec.norm(vn[i])).map(r4));
    const uv = axisUV(side, disp.base[i]);
    b.uv.push(r4(uv[0]), r4(1 - uv[1]));
  });
  for (const t of disp.tris) b.idx.push(start + t[0], start + t[1], start + t[2]);
}

/** Collision for real terrain: each displacement triangle as a thin convex prism. */
function dispPrisms(disp, mat) {
  const T = 12; // 0.3 m deep, in hammer units
  const fn = disp.fn;
  for (const [a, b, c] of disp.tris) {
    const A = disp.pos[a], B = disp.pos[b], C = disp.pos[c];
    const top = vec.norm(vec.cross(vec.sub(B, A), vec.sub(C, A)));
    if (!Number.isFinite(top[0])) continue;
    const planes = [{ n: top, d: vec.dot(top, A) }];
    const minF = Math.min(vec.dot(fn, A), vec.dot(fn, B), vec.dot(fn, C)) - T;
    planes.push({ n: fn.map((x) => -x), d: -minF });
    for (const [P, Q, R] of [[A, B, C], [B, C, A], [C, A, B]]) {
      let n = vec.norm(vec.cross(vec.sub(Q, P), fn));
      if (vec.dot(n, vec.sub(R, P)) > 0) n = n.map((x) => -x);
      planes.push({ n, d: vec.dot(n, P) });
    }
    const pts = [A, B, C, ...[A, B, C].map((p) => p.map((x, i) => x - fn[i] * (vec.dot(fn, p) - minF)))];
    addBrush(pts, planes, mat, false, true);
    prisms++;
  }
}

function addBrush(hammerPts, planes, mat, clip, forcePlanes = false) {
  const w = hammerPts.map(toW);
  const min = [0, 1, 2].map((i) => Math.min(...w.map((p) => p[i])));
  const max = [0, 1, 2].map((i) => Math.max(...w.map((p) => p[i])));
  if (max[0] - min[0] < 1e-3 || max[1] - min[1] < 1e-3 || max[2] - min[2] < 1e-3) return;
  const aligned = !forcePlanes && planes.every((pl) => Math.max(...pl.n.map(Math.abs)) > 0.9999);
  brushes.push({ min: min.map(r4), max: max.map(r4), mat, clip, planes: aligned ? null : planes.map(planeToW).map((p) => p.map(r4)) });
}

// ─── walk the brushes ─────────────────────────────────────────
const groups = [[{ props: { classname: 'worldspawn' } }, solidsOf(world)], ...ents.map((e) => [e, solidsOf(e)])];
for (const [ent, solids] of groups) {
  const cls = ent.props.classname;
  if (/^(trigger_|func_areaportal|func_occluder|func_dustmotes|func_clip_vphysics|env_)/.test(cls)) continue;
  for (const solid of solids) {
    const sides = solid.children.filter((c) => c.key === 'side');
    const mats = sides.map((s) => (s.props.material || '').toLowerCase());
    let faces;
    try { faces = brushFaces(sides); } catch { skipped++; continue; }
    const pts = faces.flatMap((f) => f.poly);
    if (faces.length < 4 || pts.some((p) => p.some((x) => !Number.isFinite(x) || Math.abs(x) > 32768))) { skipped++; continue; }
    const centre = [0, 1, 2].map((i) => (Math.min(...pts.map((p) => p[i])) + Math.max(...pts.map((p) => p[i]))) / 2);
    if (!inRegion(centre)) continue;
    const wPts = pts.map(toW);
    const box = { min: [0, 1, 2].map((i) => r4(Math.min(...wPts.map((p) => p[i])))), max: [0, 1, 2].map((i) => r4(Math.max(...wPts.map((p) => p[i])))) };

    if (cls === 'func_ladder') { ladders.push(box); continue; }
    if (cls === 'func_buyzone') { buyZones[ent.props.TeamNum === '2' ? 'T' : 'CT'] = { minX: box.min[0], maxX: box.max[0], minZ: box.min[2], maxZ: box.max[2] }; continue; }
    if (cls === 'func_bomb_target') { sites.push(box); continue; }

    // Render
    const famCount = {};
    let hasDisp = false;
    for (const f of faces) {
      if (polyArea(f.poly) < 0.01) continue;
      const fam = familyOf(f.side.props.material || '');
      const info = f.side.children.find((c) => c.key === 'dispinfo');
      if (info) {
        hasDisp = true;
        const disp = buildDisp(f, info);
        if (!disp) continue;
        if (fam) emitDisp(fam, disp, f.side);
        if (disp.dev > 6) dispPrisms(disp, fam || 'concrete');
        else dispFlat++;
        if (fam) famCount[fam] = (famCount[fam] || 0) + 100;
        continue;
      }
      if (fam) { emitPolygon(fam, f.poly, f.plane.n, f.side); famCount[fam] = (famCount[fam] || 0) + polyArea(f.poly); }
    }

    // Collision
    if (cls === 'func_illusionary' || (cls === 'func_brush' && ent.props.Solidity === '1')) continue;
    if (mats.every((m) => NOCOLLIDE.test(m))) continue;
    if (hasDisp && sides.some((s) => { const i = s.children.find((c) => c.key === 'dispinfo'); return i && buildDispDev(s, faces) > 6; })) continue; // prisms cover it
    const visible = mats.filter((m) => !m.startsWith('tools/'));
    const clip = visible.length === 0 && mats.some((m) => CLIP.test(m));
    if (visible.length === 0 && !clip && !mats.some((m) => m === 'tools/toolsnodraw' || m === 'tools/toolsblack')) continue;
    if (visible.length && visible.every((m) => familyOf(m) === null)) continue; // tree cards, sky cards, decal sheets
    const mat = Object.entries(famCount).sort((a, b) => b[1] - a[1])[0]?.[0] || (clip ? 'clip' : 'concrete');
    addBrush(pts, faces.map((f) => f.plane), mat, clip);
  }
}
function buildDispDev(side, faces) {
  const f = faces.find((x) => x.side === side);
  const info = side.children.find((c) => c.key === 'dispinfo');
  const d = f && buildDisp(f, info);
  return d ? d.dev : 0;
}

// ─── entities ─────────────────────────────────────────────────
// Hammer yaw (0 = east, 90 = north) → ours (dirFromAngles: yaw 0 looks down -Z = north).
const yawOf = (e) => { const a = (Number((e.props.angles || '0 0 0').split(/\s+/)[1]) || 0) * Math.PI / 180; return Math.atan2(-Math.cos(a), Math.sin(a)); };
const spawn = (e) => { const w = toW(origin(e)); return [r4(w[0]), r4(w[2]), r4(w[1] + 0.05), r4(yawOf(e))]; };
const spawns = {
  T: byClass('info_player_terrorist').map(spawn),
  CT: byClass('info_player_counterterrorist').map(spawn),
  FFA: byClass('info_deathmatch_spawn').map(spawn),
};
if (!spawns.FFA.length) spawns.FFA = [...spawns.T, ...spawns.CT];

// Sites: the northern one is A (Hammer +y → our -z).
sites.sort((a, b) => a.min[2] - b.min[2]);
const siteDefs = {};
sites.forEach((b, i) => {
  const n = i === 0 ? 'A' : 'B';
  siteDefs[n] = { name: n, minX: b.min[0], maxX: b.max[0], minZ: b.min[2], maxZ: b.max[2], minY: b.min[1], maxY: b.max[1], center: [r4((b.min[0] + b.max[0]) / 2), r4((b.min[2] + b.max[2]) / 2)], floor: b.min[1] };
});

const env = byClass('light_environment')[0];
let sun = null;
if (env) {
  const pitch = Number(env.props.pitch) || -45;
  const yaw = Number((env.props.angles || '0 0 0').split(/\s+/)[1]) || 0;
  // The light points along (yaw, pitch); the sun sits the opposite way.
  const el = -pitch * Math.PI / 180, az = (yaw + 180) * Math.PI / 180;
  const h = [Math.cos(az) * Math.cos(el), Math.sin(az) * Math.cos(el), Math.sin(el)];
  const col = nums(env.props._light).slice(0, 3).map((x) => x / 255);
  const amb = nums(env.props._ambient).slice(0, 3).map((x) => x / 255);
  sun = { dir: nToW(h).map(r4), color: col.map(r4), ambient: amb.map(r4), elevation: r4(-pitch) };
}

const all = brushes.reduce((b, x) => ({ min: b.min.map((v, i) => Math.min(v, x.min[i])), max: b.max.map((v, i) => Math.max(v, x.max[i])) }), { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] });
const playable = [...spawns.T, ...spawns.CT, ...spawns.FFA].reduce((b, s) => ({ minX: Math.min(b.minX, s[0]), maxX: Math.max(b.maxX, s[0]), minZ: Math.min(b.minZ, s[1]), maxZ: Math.max(b.maxZ, s[1]) }), { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity });
const pad = 30;
const bounds = { minX: Math.max(all.min[0], playable.minX - pad), maxX: Math.min(all.max[0], playable.maxX + pad), minZ: Math.max(all.min[2], playable.minZ - pad), maxZ: Math.min(all.max[2], playable.maxZ + pad) };
for (const k of Object.keys(bounds)) bounds[k] = Math.round(bounds[k]);

// ─── write collision module ───────────────────────────────────
const MATS = [...new Set(brushes.map((b) => b.mat))];
const flat = [], planes = [];
for (const b of brushes) {
  const pStart = planes.length / 4;
  if (b.planes) for (const p of b.planes) planes.push(...p);
  flat.push(...b.min, ...b.max, MATS.indexOf(b.mat), (b.clip ? 1 : 0) | (PENETRABLE.has(b.mat) ? 2 : 0), b.planes ? pStart : -1, b.planes ? b.planes.length : 0);
}
const out = {
  name, title, source: path.basename(file), scale: S, bounds,
  floorY: r4(all.min[1]), sun, spawns, sites: siteDefs, buyZones, ladders,
  mats: MATS, stride: 10, brushes: flat, planes,
};
mkdirSync(path.join(ROOT, 'shared/maps'), { recursive: true });
writeFileSync(path.join(ROOT, `shared/maps/${name}.js`),
  `// Generated by tools/vmf2map.mjs from ${path.basename(file)} — do not edit by hand.\n` +
  `// brushes: [minX,minY,minZ, maxX,maxY,maxZ, matIndex, flags(1 clip, 2 penetrable), planeStart, planeCount] × n\n` +
  `export default ${JSON.stringify(out)};\n`);

// ─── write render GLB ─────────────────────────────────────────
const chunks = [], views = [], accessors = [], meshes = [], nodes = [], materials = [];
let byteLen = 0;
const push = (typed, target) => {
  const buf = Buffer.from(typed.buffer, typed.byteOffset, typed.byteLength);
  const padTo = (4 - (byteLen % 4)) % 4;
  if (padTo) { chunks.push(Buffer.alloc(padTo)); byteLen += padTo; }
  views.push({ buffer: 0, byteOffset: byteLen, byteLength: buf.length, target });
  chunks.push(buf); byteLen += buf.length;
  return views.length - 1;
};
for (const [fam, b] of render) {
  if (!b.idx.length) continue;
  const pos = new Float32Array(b.pos), nor = new Float32Array(b.nor), uv = new Float32Array(b.uv), idx = new Uint32Array(b.idx);
  const mn = [0, 1, 2].map((i) => Math.min(...pos.filter((_, k) => k % 3 === i)));
  const mx = [0, 1, 2].map((i) => Math.max(...pos.filter((_, k) => k % 3 === i)));
  const a = accessors.length;
  accessors.push({ bufferView: push(pos, 34962), componentType: 5126, count: pos.length / 3, type: 'VEC3', min: mn, max: mx });
  accessors.push({ bufferView: push(nor, 34962), componentType: 5126, count: nor.length / 3, type: 'VEC3' });
  accessors.push({ bufferView: push(uv, 34962), componentType: 5126, count: uv.length / 2, type: 'VEC2' });
  accessors.push({ bufferView: push(idx, 34963), componentType: 5125, count: idx.length, type: 'SCALAR' });
  materials.push({ name: fam, pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } });
  meshes.push({ name: fam, primitives: [{ attributes: { POSITION: a, NORMAL: a + 1, TEXCOORD_0: a + 2 }, indices: a + 3, material: materials.length - 1 }] });
  nodes.push({ name: fam, mesh: meshes.length - 1 });
}
const bin = Buffer.concat(chunks);
const gltf = {
  asset: { version: '2.0', generator: 'FRONTLINE vmf2map' },
  scene: 0, scenes: [{ nodes: nodes.map((_, i) => i) }], nodes, meshes, materials, accessors, bufferViews: views,
  buffers: [{ byteLength: bin.length }],
};
let json = Buffer.from(JSON.stringify(gltf));
json = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
const binPad = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4)]);
const header = Buffer.alloc(12);
header.writeUInt32LE(0x46546c67, 0); header.writeUInt32LE(2, 4); header.writeUInt32LE(12 + 8 + json.length + 8 + binPad.length, 8);
const ch = (len, type) => { const b = Buffer.alloc(8); b.writeUInt32LE(len, 0); b.writeUInt32LE(type, 4); return b; };
mkdirSync(path.join(ROOT, 'client/assets/maps'), { recursive: true });
const glbPath = path.join(ROOT, `client/assets/maps/${name}.glb`);
writeFileSync(glbPath, Buffer.concat([header, ch(json.length, 0x4e4f534a), json, ch(binPad.length, 0x004e4942), binPad]));

const tris = [...render.values()].reduce((s, b) => s + b.idx.length / 3, 0);
console.log(`${name}: ${brushes.length} collision brushes (${brushes.filter((b) => b.planes).length} non-axial, ${prisms} terrain prisms, ${brushes.filter((b) => b.clip).length} clip), ${dispFlat} flat displacements, ${skipped} degenerate skipped`);
console.log(`render: ${render.size} surface families, ${tris} triangles → ${glbPath}`);
console.log(`spawns T ${spawns.T.length} CT ${spawns.CT.length} FFA ${spawns.FFA.length}; sites ${Object.keys(siteDefs)}; buy zones ${Object.keys(buyZones)}; ladders ${ladders.length}; bounds`, bounds, 'sun', sun);
