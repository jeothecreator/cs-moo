// World builder. The shared collision boxes become textured, merged geometry with world-anchored
// UVs; each map theme then adds its own sky, light rig and set dressing:
//   trenches — overcast front line: plank revetments, sandbag parapets, wire, mud, bunkers
//   seoul    — a street block at dusk: storefronts, apartment storeys, neon, trucks, wires
//   rooftop  — a green-coated Seoul rooftop at golden hour above the city
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { MAP } from '/shared/map.js';
import { makeTextures, textTexture, signTexture, vendingTexture, normalMapFor } from './textures.js';

export const IMPACT_COLORS = {
  earth: 0x5a4632, sandbag: 0x8a7a58, bunker: 0x8a877f, crate: 0x6a6440, wood: 0x7b6c5a, door: 0x6a5640,
  metal: 0x6e5a48, facade: 0xb8ab98, shop: 0x55585c, brick: 0x8b4a32, concrete: 0xa7a39b, vending: 0x3a6f9c,
  car: 0xd8dade, parapet: 0xc7c2b8, steel: 0xb9bdc0, barricade: 0x8a7a58, ground: 0x4b3c2c,
};

let rseed = 7;
const rnd = () => ((rseed = (rseed * 16807) % 2147483647) - 1) / 2147483646;
const rr = (a, b) => a + rnd() * (b - a);

// ─── themes ───────────────────────────────────────────────────
const THEMES = {
  trenches: {
    sun: [26, 212], sky: { turbidity: 7, rayleigh: 1.4, mie: 0.004, mieG: 0.7, clouds: 0.88, density: 0.8, scale: 0.07 },
    fog: [0x6c6a64, 40, 300], exposure: 1.1, sunColor: 0xffe8cc, sunI: 2.4, hemi: [0x9aa6b4, 0x3b3026, 1.2], env: 0.7,
    ground: { tex: 'mud', tile: 7, rough: 0.82 },
  },
  seoul: {
    sun: [5, 250], sky: { turbidity: 5, rayleigh: 3.2, mie: 0.008, mieG: 0.92, clouds: 0.38, density: 0.35, scale: 0.12 },
    fog: [0x5d5a76, 80, 420], exposure: 1.2, sunColor: 0xff9d60, sunI: 2.6, hemi: [0x8090c8, 0x3a302c, 1.35], env: 0.8,
    ground: { tex: 'asphalt', tile: 9, rough: 0.5 },
  },
  rooftop: {
    sun: [8, 236], sky: { turbidity: 4, rayleigh: 2.6, mie: 0.006, mieG: 0.9, clouds: 0.3, density: 0.3, scale: 0.12 },
    fog: [0x9d8f98, 140, 700], exposure: 1.08, sunColor: 0xffb26e, sunI: 3.8, hemi: [0x86a2d8, 0x4a3a30, 0.95], env: 0.85,
    ground: { tex: 'rooftop', tile: 10, rough: 0.55, onlyBounds: true },
  },
};

// Surface presets: texture, metres per tile (su × sv) or `fit` (whole tiles across a face).
const SURF = {
  revet: { tex: 'revet', su: 2.6, sv: 2.6 },
  sandbag: { tex: 'sandbag', su: 2.4, sv: 1.6, rough: 1 },
  dirt: { tex: 'dirt', su: 4, sv: 4, rough: 1 },
  bunker: { tex: 'bunker', su: 4, sv: 4 },
  ammo: { tex: 'crate', fit: 1, rough: 0.85 },
  wood: { tex: 'wood', su: 2.2, sv: 2.2 },
  door: { tex: 'door', fit: 2.4 },
  rust: { tex: 'metal', su: 2.4, sv: 2.4, rough: 0.7, metal: 0.4 },
  shop: { tex: 'shop', su: 6, sv: 4.2, rough: 0.3, glow: 'shopGlow', glowI: 0.55 },
  facade: { tex: 'facade', su: 24, sv: 12, rough: 0.8, glow: 'facadeGlow', glowI: 0.75 },
  plaster: { tex: 'plaster', su: 3, sv: 3 },
  brick: { tex: 'brick', su: 3, sv: 3 },
  concrete: { tex: 'concrete', su: 3, sv: 3 },
  slab: { tex: 'concrete', su: 6, sv: 6, color: 0x8d8a85 },
  cardboard: { tex: 'cardboard', fit: 0.9 },
  panel: { tex: 'steel', su: 2, sv: 2, color: 0x7d98b5, rough: 0.5, metal: 0.3 },
  pallet: { tex: 'wood', fit: 1.2 },
};

// How each collision material looks per theme: vertical bands of surfaces, a top surface, and
// optionally a separate face material for the inside of a room or a custom model instead.
const LOOK = {
  trenches: {
    earth: { bands: [[2.4, 'revet'], [99, 'sandbag']], top: 'dirt' },
    bunker: { bands: [[99, 'bunker']], top: 'bunker' },
    crate: { bands: [[99, 'ammo']], top: 'ammo' },
    sandbag: { bands: [[99, 'sandbag']], top: 'sandbag' },
    door: { bands: [[99, 'door']], top: 'wood' },
    metal: { bands: [[99, 'rust']], top: 'rust' },
    wood: { bands: [[99, 'wood']], top: 'wood' },
  },
  seoul: {
    facade: { bands: [[4.2, 'shop'], [99, 'facade']], top: 'slab' },
    shop: { bands: [[99, 'shop']], inner: 'plaster', top: 'slab' },
    crate: { bands: [[99, 'cardboard']], top: 'cardboard' },
    concrete: { bands: [[99, 'concrete']], top: 'concrete' },
    brick: { bands: [[99, 'brick']], top: 'concrete' },
    vending: { model: 'vending' },
    car: { model: 'truck' },
  },
  rooftop: {
    parapet: { model: 'parapet' },
    concrete: { bands: [[99, 'concrete']], top: 'concrete' },
    steel: { model: 'rooftopUnit' },
    crate: { bands: [[99, 'cardboard']], top: 'cardboard' },
    wood: { bands: [[99, 'pallet']], top: 'pallet' },
    metal: { bands: [[99, 'panel']], top: 'panel' },
  },
};

// ─── materials ────────────────────────────────────────────────

// MeshStandardMaterial + the procedural normal map that belongs to its colour map.
function stdMat(opts) {
  const n = normalMapFor(opts.map);
  return new THREE.MeshStandardMaterial(n ? { normalMap: n, normalScale: new THREE.Vector2(1, 1), ...opts } : opts);
}

// ─── geometry: world-anchored quads grouped by surface ────────
const SIDES = [
  { n: [0, 0, 1], range: (b) => [b.min[0], b.max[0]], pt: (b, t, y) => [t, y, b.max[2]] },
  { n: [0, 0, -1], range: (b) => [-b.max[0], -b.min[0]], pt: (b, t, y) => [-t, y, b.min[2]] },
  { n: [1, 0, 0], range: (b) => [-b.max[2], -b.min[2]], pt: (b, t, y) => [b.max[0], y, -t] },
  { n: [-1, 0, 0], range: (b) => [b.min[2], b.max[2]], pt: (b, t, y) => [b.min[0], y, t] },
];

class Surfaces {
  constructor() { this.parts = new Map(); }

  quad(key, p, n, uv, ao) {
    if (!this.parts.has(key)) this.parts.set(key, { pos: [], nor: [], uv: [], col: [] });
    const s = this.parts.get(key);
    for (const i of [0, 1, 2, 0, 2, 3]) {
      s.pos.push(...p[i]); s.nor.push(...n); s.uv.push(...uv[i]); s.col.push(ao[i], ao[i], ao[i]);
    }
  }

  /** A box rendered with banded side surfaces and a top surface. */
  box(b, look, { innerTest = null } = {}) {
    const y0 = b.min[1], y1 = b.max[1];
    const ground = y0 <= 0.01;
    for (const f of SIDES) {
      const [u0, u1] = f.range(b);
      const inner = innerTest?.(f.n, b);
      let from = y0;
      for (const [to, surfName] of look.bands) {
        const top = Math.min(y1, y0 + to);
        if (top <= from) continue;
        const key = inner ? look.inner : surfName;
        const sp = SURF[key];
        const bandStart = from === y0 ? y0 : from;
        let uvs;
        if (sp.fit) {
          const len = u1 - u0, h = y1 - y0;
          const ru = Math.max(1, Math.round(len / sp.fit)), rv = Math.max(1, Math.round(h / sp.fit));
          const v = (y) => ((y - y0) / h) * rv;
          uvs = [[0, v(from)], [ru, v(from)], [ru, v(top)], [0, v(top)]];
        } else {
          const v = (y) => (y - bandStart) / sp.sv;
          uvs = [[u0 / sp.su, v(from)], [u1 / sp.su, v(from)], [u1 / sp.su, v(top)], [u0 / sp.su, v(top)]];
        }
        const aoLow = ground && from === y0 ? 0.6 : 0.85;
        this.quad(key, [f.pt(b, u0, from), f.pt(b, u1, from), f.pt(b, u1, top), f.pt(b, u0, top)], f.n, uvs, [aoLow, aoLow, 1, 1]);
        from = top;
        if (from >= y1) break;
      }
    }
    if (look.top) {
      const sp = SURF[look.top];
      const [x0, z0, x1, z1] = [b.min[0], b.min[2], b.max[0], b.max[2]];
      const uv = sp.fit
        ? [[0, 0], [Math.max(1, Math.round((x1 - x0) / sp.fit)), 0], [Math.max(1, Math.round((x1 - x0) / sp.fit)), Math.max(1, Math.round((z1 - z0) / sp.fit))], [0, Math.max(1, Math.round((z1 - z0) / sp.fit))]]
        : [[x0 / sp.su, z1 / sp.sv], [x1 / sp.su, z1 / sp.sv], [x1 / sp.su, z0 / sp.sv], [x0 / sp.su, z0 / sp.sv]];
      this.quad(look.top, [[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], uv, [1, 1, 1, 1]);
    }
    if (look.bottom) { // ceilings: slabs seen from inside a room
      const sp = SURF[look.bottom];
      const [x0, z0, x1, z1] = [b.min[0], b.min[2], b.max[0], b.max[2]];
      const uv = [[x0 / sp.su, z0 / sp.sv], [x1 / sp.su, z0 / sp.sv], [x1 / sp.su, z1 / sp.sv], [x0 / sp.su, z1 / sp.sv]];
      this.quad(look.bottom, [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], [0, -1, 0], uv, [0.8, 0.8, 0.8, 0.8]);
    }
  }

  meshes(materialFor) {
    const out = [];
    for (const [key, s] of this.parts) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(s.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(s.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(s.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(s.col, 3));
      g.computeBoundingSphere();
      const mesh = new THREE.Mesh(g, materialFor(key));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.surface = key;
      out.push(mesh);
    }
    return out;
  }
}

/** Collects many small static props and merges them into one mesh per material. */
class Batch {
  constructor() { this.lists = new Map(); this.flags = new Map(); }

  add(geo, material, matrix, { cast = true } = {}) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    if (!g.attributes.normal) g.computeVertexNormals();
    g.applyMatrix4(matrix);
    if (!this.lists.has(material)) this.lists.set(material, []);
    this.lists.get(material).push(g);
    if (!cast) this.flags.set(material, false);
  }

  place(geo, material, x, y, z, { ry = 0, rx = 0, rz = 0, s = 1, sx = s, sy = s, sz = s, cast = true } = {}) {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')),
      new THREE.Vector3(sx, sy, sz),
    );
    this.add(geo, material, m, { cast });
  }

  flush(parent) {
    for (const [mat, list] of this.lists) {
      const merged = mergeGeometries(list);
      for (const g of list) g.dispose();
      const mesh = new THREE.Mesh(merged, mat);
      mesh.castShadow = this.flags.get(mat) !== false;
      mesh.receiveShadow = true;
      parent.add(mesh);
    }
    this.lists.clear();
  }
}

// ─── sky ──────────────────────────────────────────────────────
function sunVector([elevation, azimuth]) {
  return new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elevation), THREE.MathUtils.degToRad(azimuth));
}

function makeSky(sunDir, p) {
  const sky = new Sky();
  sky.scale.setScalar(12000);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  const u = sky.material.uniforms;
  u.turbidity.value = p.turbidity;
  u.rayleigh.value = p.rayleigh;
  u.mieCoefficient.value = p.mie;
  u.mieDirectionalG.value = p.mieG;
  u.cloudCoverage.value = p.clouds;
  u.cloudDensity.value = p.density;
  u.cloudScale.value = 0.00022;
  u.cloudSpeed.value = 0.00003;
  u.cloudElevation.value = 0.42;
  u.sunPosition.value.copy(sunDir);
  // The atmospheric model returns raw radiance (tens of units). Left alone it swamps the
  // bloom threshold and veils the whole frame in white, so scale it into a sane HDR range.
  u.skyScale = { value: p.scale };
  sky.material.fragmentShader = 'uniform float skyScale;\n' + sky.material.fragmentShader.replace(
    'gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor * skyScale, 1.0 );');
  sky.material.needsUpdate = true;
  return sky;
}

// ─── shared props ─────────────────────────────────────────────
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 14),
  cyl6: new THREE.CylinderGeometry(0.5, 0.5, 1, 6),
  sphere: new THREE.IcosahedronGeometry(0.5, 1),
  plane: new THREE.PlaneGeometry(1, 1),
};

/** Concertina wire as line segments: a helix from (x,y,z) along `dir` (unit, horizontal). */
function pushCoil(out, x, y, z, dirX, dirZ, length = 4, radius = 0.32, turns = 10) {
  const steps = turns * 12;
  let prev = null;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, a = t * turns * Math.PI * 2;
    const along = t * length - length / 2, side = Math.cos(a) * radius, up = Math.sin(a) * radius + radius;
    const p = [x + dirX * along - dirZ * side, y + up, z + dirZ * along + dirX * side];
    if (prev) out.push(...prev, ...p);
    prev = p;
  }
}
function wireMesh(points, color = 0x4a4642) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  return new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color }));
}

function emissive(color, intensity = 2, opts = {}) {
  return new THREE.MeshStandardMaterial({ color: 0x111111, emissive: color, emissiveIntensity: intensity, roughness: 0.4, ...opts });
}

function signMesh(texture, w, h, intensity = 1.6) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({
    map: texture, emissiveMap: texture, emissive: 0xffffff, emissiveIntensity: intensity, roughness: 0.5, transparent: false,
  }));
  return m;
}

/** Vertical blade sign — the stacked-character neon signs that line Korean streets. */
function bladeSign(text, fg, glow, bg = '#101114') {
  const chars = [...text];
  const c = document.createElement('canvas');
  c.width = 160; c.height = 160 * chars.length;
  const ctx = c.getContext('2d');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = glow; ctx.lineWidth = 6; ctx.shadowColor = glow; ctx.shadowBlur = 18; ctx.strokeRect(8, 8, c.width - 16, c.height - 16);
  ctx.font = '900 112px "Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = fg;
  chars.forEach((ch, i) => ctx.fillText(ch, 80, 160 * i + 86));
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ─── build ────────────────────────────────────────────────────
export function buildWorld(targetScene, renderer, { shadows = true } = {}) {
  rseed = 7;
  const scene = new THREE.Group();
  targetScene.add(scene);
  const tex = makeTextures();
  const updaters = [];
  const themeName = MAP.theme || 'trenches';
  const T = THEMES[themeName];
  const B = MAP.bounds;

  // Sky, fog and image-based lighting from that same sky, so ambient colour matches the horizon.
  const sunDir = sunVector(T.sun);
  const sky = makeSky(sunDir, T.sky);
  scene.add(sky);
  targetScene.background = null;
  targetScene.fog = new THREE.Fog(T.fog[0], T.fog[1], T.fog[2]);
  updaters.push((dt) => { sky.material.uniforms.time.value += dt * 1000; });
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envSky = makeSky(sunDir, T.sky);
  envSky.scale.setScalar(450);
  const envScene = new THREE.Scene();
  envScene.add(envSky);
  targetScene.environment = pmrem.fromScene(envScene, 0, 1, 2000).texture;
  targetScene.environmentIntensity = T.env;
  envSky.geometry.dispose();
  envSky.material.dispose();
  pmrem.dispose();

  const hemi = new THREE.HemisphereLight(T.hemi[0], T.hemi[1], T.hemi[2]);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(T.sunColor, T.sunI);
  sun.position.copy(sunDir).multiplyScalar(220);
  sun.target.position.set(0, 0, 0);
  scene.add(sun, sun.target);
  if (shadows) {
    const ext = Math.max(B.maxX - B.minX, B.maxZ - B.minZ) / 2 + 12;
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const cam = sun.shadow.camera;
    cam.left = -ext; cam.right = ext; cam.top = ext; cam.bottom = -ext; cam.near = 10; cam.far = 460;
    sun.shadow.bias = -0.0003;
    sun.shadow.normalBias = 0.035;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
  }

  // Surface materials, created on demand.
  const matCache = new Map();
  const surfMat = (key, vertexColors = true) => {
    const id = `${key}:${vertexColors}`;
    if (matCache.has(id)) return matCache.get(id);
    const sp = SURF[key];
    const opts = { map: tex[sp.tex], roughness: sp.rough ?? 0.9, metalness: sp.metal ?? 0, vertexColors };
    if (sp.color) opts.color = sp.color;
    if (sp.glow) { opts.emissiveMap = tex[sp.glow]; opts.emissive = new THREE.Color(0xffffff); opts.emissiveIntensity = sp.glowI; }
    const m = stdMat(opts);
    matCache.set(id, m);
    return m;
  };

  // Collision boxes → banded surfaces (or a custom model for vehicles, machines, rooftop units).
  const looks = LOOK[themeName];
  const surfaces = new Surfaces();
  const batch = new Batch();
  const modelBoxes = [];
  const centerRoomTest = (n, b) => {
    // Corner shops: faces pointing away from the map centre are interior walls.
    const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    if (Math.abs(cx) < 6 && Math.abs(cz) < 6) return false;
    return n[0] * cx + n[2] * cz > 0;
  };
  for (const b of MAP.boxes) {
    const look = looks[b.mat] || { bands: [[99, 'concrete']], top: 'concrete' };
    if (look.model) { modelBoxes.push([look.model, b]); continue; }
    surfaces.box(b, look, { innerTest: look.inner ? centerRoomTest : null });
  }

  const ctx = { scene, tex, batch, surfaces, updaters, surfMat, renderer };
  if (themeName === 'trenches') dressTrenches(ctx);
  else if (themeName === 'seoul') dressSeoul(ctx, modelBoxes);
  else dressRooftop(ctx, modelBoxes);

  const collidables = surfaces.meshes((key) => surfMat(key));
  for (const m of collidables) scene.add(m);
  batch.flush(scene);

  // Ground
  const gp = T.ground;
  const groundTex = tex[gp.tex].clone();
  groundTex.needsUpdate = true;
  const gw = gp.onlyBounds ? B.maxX - B.minX + 4 : 900, gd = gp.onlyBounds ? B.maxZ - B.minZ + 4 : 900;
  groundTex.repeat.set(gw / gp.tile, gd / gp.tile);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(gw, gd), stdMat({ map: groundTex, normalMap: normalMapFor(groundTex), roughness: gp.rough }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  if (shadows) renderer.shadowMap.needsUpdate = true;

  return {
    tex,
    collidables,
    sun,
    sky,
    hemi,
    theme: themeName,
    exposure: T.exposure,
    update(dt) { for (const u of updaters) u(dt); },
    refreshShadows() { if (shadows) renderer.shadowMap.needsUpdate = true; },
    dispose() {
      targetScene.remove(scene);
      scene.traverse((o) => { o.geometry?.dispose?.(); });
    },
  };
}

// ─── Trenches ─────────────────────────────────────────────────
function dressTrenches({ scene, tex, batch, surfaces, updaters, surfMat }) {
  const B = MAP.bounds;
  const bagMat = stdMat({ map: tex.sandbag, roughness: 1 });
  const woodMat = stdMat({ map: tex.wood, roughness: 0.95 });
  const darkWood = stdMat({ map: tex.wood, color: 0x6b5a48, roughness: 1 });
  const wire = [];

  // Sandbag parapets along the lip of every earthwork, and wire on the outer line.
  for (const b of MAP.boxes) {
    if (b.mat !== 'earth') continue;
    const top = b.max[1];
    const edges = [
      [b.min[0], b.max[0], b.min[2], 'x'], [b.min[0], b.max[0], b.max[2], 'x'],
      [b.min[2], b.max[2], b.min[0], 'z'], [b.min[2], b.max[2], b.max[0], 'z'],
    ];
    for (const [a0, a1, c, axis] of edges) {
      for (let t = a0 + 0.3; t < a1 - 0.3; t += 0.62) {
        const inset = (axis === 'x' ? (c === b.min[2] ? 0.22 : -0.22) : (c === b.min[0] ? 0.22 : -0.22));
        const x = axis === 'x' ? t : c + inset, z = axis === 'x' ? c + inset : t;
        batch.place(G.box, bagMat, x, top + 0.11, z, { sx: 0.6, sy: 0.22, sz: 0.38, ry: (axis === 'x' ? 0 : Math.PI / 2) + rr(-0.08, 0.08), rz: rr(-0.06, 0.06) });
      }
    }
    const outer = b.max[0] >= B.maxX + 1 || b.min[0] <= B.minX - 1 || b.max[2] >= B.maxZ + 1 || b.min[2] <= B.minZ - 1;
    if (outer) {
      const alongX = b.max[0] - b.min[0] > b.max[2] - b.min[2];
      const len = alongX ? b.max[0] - b.min[0] : b.max[2] - b.min[2];
      const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
      for (let t = -len / 2 + 2; t < len / 2 - 2; t += 4) {
        pushCoil(wire, alongX ? cx + t : cx, top + 0.25, alongX ? cz : cz + t, alongX ? 1 : 0, alongX ? 0 : 1);
        batch.place(G.box, darkWood, alongX ? cx + t - 2 : cx, top + 0.7, alongX ? cz : cz + t - 2, { sx: 0.08, sy: 1.4, sz: 0.08, rz: rr(-0.1, 0.1) });
      }
    }
  }

  // Duckboards down the main communication trenches.
  const duck = stdMat({ map: tex.duckboard, roughness: 0.95 });
  const paths = [[0, 52, 0, -4], [-35, 46, -35, -8], [35, 46, 35, -8], [-20, -46, 20, -46], [-44, -46, -44, -16], [44, -46, 44, -16]];
  for (const [x0, z0, x1, z1] of paths) {
    const len = Math.hypot(x1 - x0, z1 - z0), steps = Math.floor(len / 2.1);
    const ang = Math.atan2(x1 - x0, z1 - z0);
    for (let i = 0; i < steps; i++) {
      const t = (i + 0.5) / steps;
      batch.place(G.box, duck, x0 + (x1 - x0) * t, 0.06, z0 + (z1 - z0) * t, { ry: ang + rr(-0.04, 0.04), sx: 1.0, sy: 0.08, sz: 2.0 });
    }
  }

  // Concrete pads at the bomb sites with a stencilled letter.
  for (const s of Object.values(MAP.sites)) {
    surfaces.box({ min: [s.minX, 0, s.minZ], max: [s.maxX, 0.04, s.maxZ], mat: 'bunker' }, { bands: [[99, 'bunker']], top: 'bunker' });
    const letter = new THREE.Mesh(new THREE.PlaneGeometry(7, 7), new THREE.MeshStandardMaterial({
      map: textTexture(s.name, { color: 'rgba(225,200,60,0.75)', font: 'bold 230px "Bebas Neue", Impact, sans-serif' }), transparent: true, depthWrite: false, roughness: 1,
    }));
    letter.rotation.x = -Math.PI / 2;
    letter.position.set(s.center[0], 0.05, s.center[1]);
    scene.add(letter);
    // painted site board on a post
    const board = signMesh(signTexture(`SITE ${s.name}`, { bg: '#d8c470', fg: '#1d1a12', font: '"Bebas Neue", Impact, sans-serif', weight: 400, w: 512, h: 160 }), 1.6, 0.5, 0.15);
    board.position.set(s.minX + 1.2, 1.7, s.maxZ - 0.6);
    scene.add(board);
    batch.place(G.box, darkWood, s.minX + 1.2, 0.8, s.maxZ - 0.62, { sx: 0.1, sy: 1.6, sz: 0.1 });
  }

  // Lanterns on the walls, oil drums.
  const lampMat = emissive(0xffb04a, 3.2);
  const ironMat = new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 0.6, metalness: 0.7 });
  for (const [x, z, nx, nz] of MAP.decor.lamps || []) {
    batch.place(G.box, ironMat, x + nx * 0.18, 2.45, z + nz * 0.18, { sx: 0.18, sy: 0.04, sz: 0.18 });
    batch.place(G.cyl6, lampMat, x + nx * 0.18, 2.3, z + nz * 0.18, { sx: 0.16, sy: 0.24, sz: 0.16, cast: false });
  }
  const drumMat = stdMat({ map: tex.metal, color: 0x6b6f4a, roughness: 0.65, metalness: 0.4 });
  for (const [x, z] of MAP.decor.barrels || []) batch.place(G.cyl, drumMat, x, 0.45, z, { sx: 0.6, sy: 0.9, sz: 0.6, ry: rnd() * 6 });

  // No-man's land beyond the line: churned earth, craters, shattered trees, stakes and wire.
  const field = new THREE.Mesh(new THREE.RingGeometry(96, 520, 48, 1), stdMat({ map: tex.dirt, roughness: 1 }));
  field.material.map = tex.dirt.clone(); field.material.map.repeat.set(70, 70); field.material.map.needsUpdate = true;
  field.rotation.x = -Math.PI / 2; field.position.y = 0.02; field.receiveShadow = true;
  scene.add(field);
  const craterMat = new THREE.MeshStandardMaterial({ color: 0x2c241b, roughness: 1 });
  const rimMat = stdMat({ map: tex.dirt, color: 0x8a7458, roughness: 1 });
  const rim = new THREE.TorusGeometry(1, 0.35, 6, 18);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x2e2620, roughness: 1 });
  for (let i = 0; i < 70; i++) {
    const a = rnd() * Math.PI * 2, d = rr(100, 240);
    const x = Math.cos(a) * d, z = Math.sin(a) * d, r = rr(2.5, 7);
    batch.place(G.cyl, craterMat, x, 0.03, z, { sx: r * 1.7, sy: 0.02, sz: r * 1.7 });
    batch.place(rim, rimMat, x, 0.05, z, { rx: Math.PI / 2, s: r, sz: r * 0.6 });
  }
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2, d = rr(104, 220), h = rr(4, 11);
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    batch.place(G.cyl6, trunkMat, x, h / 2, z, { sx: rr(0.35, 0.6), sy: h, sz: rr(0.35, 0.6), rz: rr(-0.15, 0.15) });
    for (let k = 0; k < 3; k++) batch.place(G.cyl6, trunkMat, x, h * rr(0.55, 0.9), z, { sx: 0.15, sy: rr(1.5, 3), sz: 0.15, rz: rr(0.7, 1.3) * (rnd() < 0.5 ? -1 : 1), ry: rnd() * 6 });
  }
  for (let ring = 0; ring < 2; ring++) {
    const R = 104 + ring * 16;
    for (let a = 0; a < Math.PI * 2; a += 4 / R) {
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      batch.place(G.box, darkWood, x, 0.6, z, { sx: 0.08, sy: 1.2, sz: 0.08, rz: rr(-0.2, 0.2) });
      if (rnd() < 0.8) pushCoil(wire, x, 0.02, z, -Math.sin(a), Math.cos(a), 4, 0.36, 9);
    }
  }
  scene.add(wireMesh(wire));

  // Smoke columns on the horizon.
  const smokeTex = makeSmokeColumnTexture();
  const smokeMat = new THREE.SpriteMaterial({ map: smokeTex, color: 0x3a3632, transparent: true, depthWrite: false, opacity: 0.75 });
  const columns = [];
  for (let i = 0; i < 5; i++) {
    const s = new THREE.Sprite(smokeMat);
    const a = rr(-0.6, 0.6) + (i % 2 ? Math.PI : 0), d = rr(170, 260);
    s.position.set(Math.cos(a) * d, 45, Math.sin(a) * d);
    s.scale.set(rr(40, 60), 110, 1);
    scene.add(s);
    columns.push(s);
  }
  let t = 0;
  updaters.push((dt) => { t += dt; columns.forEach((c, i) => { c.material.rotation = Math.sin(t * 0.05 + i) * 0.03; }); });
}

function makeSmokeColumnTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const ctx = c.getContext('2d');
  for (let i = 0; i < 70; i++) {
    const y = 256 - (i / 70) * 256, spread = 12 + (i / 70) * 48;
    const x = 64 + Math.sin(i * 0.4) * (i / 70) * 18 + (rnd() - 0.5) * spread * 0.6;
    const r = 10 + (i / 70) * 34;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${0.25 * (1 - i / 90)})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ─── Seoul ────────────────────────────────────────────────────
const SHOP_NAMES = [
  ['편의점', '#ffffff', '#1f7a4d', '#4dffb0'], ['치킨', '#ffe066', '#b3261e', '#ff6a3d'], ['노래방', '#ff9df2', '#2a1145', '#ff4fe3'],
  ['PC방', '#9be7ff', '#0d2c4a', '#3fc5ff'], ['약국', '#ffffff', '#0f5c3a', '#56ff9a'], ['카페', '#f6e7c8', '#3a2a1e', '#ffc98a'],
  ['분식', '#fff4b0', '#c0392b', '#ffd23f'], ['호프', '#ffd27a', '#2b1d10', '#ffab3d'],
];
const BLADES = [['노래연습장', '#ffffff', '#ff3fd2'], ['모텔', '#ffffff', '#ff4060'], ['치과', '#ffffff', '#40c4ff'], ['당구장', '#fff6a0', '#ffd000'],
  ['게임', '#ffffff', '#7c4dff'], ['국밥', '#ffffff', '#ff7a2f'], ['한의원', '#ffffff', '#3dff8a'], ['스터디카페', '#ffffff', '#40a0ff']];

function dressSeoul({ scene, tex, batch, surfaces, updaters, surfMat }, modelBoxes) {
  const B = MAP.bounds;
  const metalDark = new THREE.MeshStandardMaterial({ color: 0x2b2e31, roughness: 0.5, metalness: 0.7 });
  const glassMat = new THREE.MeshStandardMaterial({ color: 0x0f1418, roughness: 0.05, metalness: 0.9 });
  const tire = new THREE.MeshStandardMaterial({ color: 0x151617, roughness: 0.9 });

  // Corner shops get a roof slab, a lit ceiling and a signboard over each street-facing wall.
  let shopIdx = 0;
  const rooms = [[1, 1], [-1, 1], [1, -1], [-1, -1]];
  const ceilingLight = emissive(0xfff3dc, 2.2);
  for (const [sx, sz] of rooms) {
    const x0 = sx * 20, x1 = sx * 35, z0 = sz * 20, z1 = sz * 35;
    surfaces.box({ min: [Math.min(x0, x1), 4.2, Math.min(z0, z1)], max: [Math.max(x0, x1), 4.5, Math.max(z0, z1)] }, { bands: [[99, 'slab']], top: 'slab', bottom: 'plaster' });
    for (let i = 0; i < 3; i++) batch.place(G.box, ceilingLight, sx * 27.5 + (i - 1) * 4, 4.16, sz * 27.5, { sx: 2.4, sy: 0.04, sz: 0.5, cast: false });
    const interior = new THREE.PointLight(0xffefd2, 18, 14, 1.6);
    interior.position.set(sx * 27.5, 3.6, sz * 27.5);
    scene.add(interior);
  }
  for (const b of MAP.boxes) {
    if (b.mat !== 'shop') continue;
    const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    const w = b.max[0] - b.min[0], d = b.max[2] - b.min[2];
    const kiosk = Math.abs(cx) < 6 && Math.abs(cz) < 6;
    const faces = kiosk
      ? [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0]]
      : [w > d ? [0, 0, -Math.sign(cz)] : [-Math.sign(cx), 0, 0]];
    for (const n of faces) {
      const len = n[0] ? d : w;
      if (len < 3) continue;
      const [name, fg, bg, glow] = SHOP_NAMES[shopIdx++ % SHOP_NAMES.length];
      const sw = Math.min(len - 0.6, kiosk ? 6.2 : 5.5);
      const sign = signMesh(signTexture(name, { fg, bg, glow, border: glow }), sw, sw / 4.2, 1.4);
      const px = n[0] ? (n[0] > 0 ? b.max[0] : b.min[0]) + n[0] * 0.08 : cx;
      const pz = n[2] ? (n[2] > 0 ? b.max[2] : b.min[2]) + n[2] * 0.08 : cz;
      sign.position.set(px, b.max[1] - (kiosk ? 0.9 : 0.62), pz);
      sign.rotation.y = Math.atan2(n[0], n[2]);
      scene.add(sign);
    }
  }

  // Blade signs and AC units on the inside faces of the perimeter buildings.
  const acMat = new THREE.MeshStandardMaterial({ color: 0xdedcd6, roughness: 0.6 });
  let bladeIdx = 0;
  for (const b of MAP.boxes) {
    if (b.mat !== 'facade') continue;
    const alongX = b.max[0] - b.min[0] > b.max[2] - b.min[2];
    const inward = alongX ? -Math.sign((b.min[2] + b.max[2]) / 2) : -Math.sign((b.min[0] + b.max[0]) / 2);
    const faceC = alongX ? (inward > 0 ? b.max[2] : b.min[2]) : (inward > 0 ? b.max[0] : b.min[0]);
    const span = alongX ? [B.minX + 4, B.maxX - 4] : [B.minZ + 4, B.maxZ - 4];
    for (let t = span[0]; t <= span[1]; t += 9.5) {
      const [txt, fg, glow] = BLADES[bladeIdx++ % BLADES.length];
      const h = 1.1 * [...txt].length;
      const sign = signMesh(bladeSign(txt, fg, glow), 1.1, h, 1.7);
      const y = 5.4 + h / 2 + rnd() * 2.5;
      if (alongX) { sign.position.set(t, y, faceC + inward * 0.75); sign.rotation.y = Math.PI / 2; }
      else { sign.position.set(faceC + inward * 0.75, y, t); }
      scene.add(sign);
      const back = sign.clone(); back.rotation.y += Math.PI; scene.add(back);
      // bracket
      if (alongX) batch.place(G.box, metalDark, t, y + h / 2 + 0.1, faceC + inward * 0.4, { sx: 0.08, sy: 0.08, sz: 0.8 });
      else batch.place(G.box, metalDark, faceC + inward * 0.4, y + h / 2 + 0.1, t, { sx: 0.8, sy: 0.08, sz: 0.08 });
    }
    for (let t = span[0] + 3; t <= span[1]; t += 6) {
      for (let floor = 0; floor < 3; floor++) {
        if (rnd() < 0.35) continue;
        const y = 4.2 + floor * 3 + 1.1;
        const off = rr(-1.2, 1.2);
        if (alongX) batch.place(G.box, acMat, t + off, y, faceC + inward * 0.25, { sx: 0.8, sy: 0.6, sz: 0.4 });
        else batch.place(G.box, acMat, faceC + inward * 0.25, y, t + off, { sx: 0.4, sy: 0.6, sz: 0.8 });
      }
    }
  }

  // Overhead power and telecom lines — the tangle every Seoul alley has.
  const lineMat = new THREE.LineBasicMaterial({ color: 0x141414 });
  for (let i = 0; i < 16; i++) {
    const alongX = i % 2 === 0;
    const p = rr(-30, 30), y0 = rr(7, 10), y1 = rr(7, 10);
    const a = alongX ? new THREE.Vector3(B.minX - 1, y0, p) : new THREE.Vector3(p, y0, B.minZ - 1);
    const b = alongX ? new THREE.Vector3(B.maxX + 1, y1, p + rr(-6, 6)) : new THREE.Vector3(p + rr(-6, 6), y1, B.maxZ + 1);
    const pts = [];
    for (let s = 0; s <= 20; s++) {
      const t = s / 20;
      pts.push(new THREE.Vector3().lerpVectors(a, b, t).add(new THREE.Vector3(0, -Math.sin(t * Math.PI) * rr(0.8, 1.6), 0)));
    }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
  }

  // Street lamps with real light pools near the centre.
  const lampHead = emissive(0xffe2b0, 4);
  let lights = 0;
  for (const [x, z, nx, nz] of MAP.decor.lamps || []) {
    const px = x + nx * 0.6, pz = z + nz * 0.6;
    batch.place(G.cyl, metalDark, px, 3.2, pz, { sx: 0.14, sy: 6.4, sz: 0.14 });
    batch.place(G.box, metalDark, px + nx * 0.7, 6.35, pz + nz * 0.7, { sx: nx ? 1.5 : 0.1, sy: 0.1, sz: nz ? 1.5 : 0.1 });
    batch.place(G.box, lampHead, px + nx * 1.4, 6.25, pz + nz * 1.4, { sx: 0.5, sy: 0.08, sz: 0.3, cast: false });
    if (lights++ < 6) {
      const l = new THREE.PointLight(0xffd9a0, 30, 20, 1.6);
      l.position.set(px + nx * 1.4, 6, pz + nz * 1.4);
      scene.add(l);
    }
  }

  // Road markings: zebra crossings and centre lines.
  const paint = new THREE.MeshStandardMaterial({ color: 0xe8e6df, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
  const yellow = new THREE.MeshStandardMaterial({ color: 0xe7b416, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 });
  for (const s of [-1, 1]) {
    for (let i = -4; i <= 4; i++) {
      batch.place(G.box, paint, i * 1.1, 0.012, s * 23, { sx: 0.55, sy: 0.01, sz: 3.2, cast: false });
      batch.place(G.box, paint, s * 23, 0.012, i * 1.1, { sx: 3.2, sy: 0.01, sz: 0.55, cast: false });
    }
    for (let t = 5; t < 19; t += 3) {
      batch.place(G.box, yellow, 0, 0.012, s * t, { sx: 0.15, sy: 0.01, sz: 1.8, cast: false });
      batch.place(G.box, yellow, s * t, 0.012, 0, { sx: 1.8, sy: 0.01, sz: 0.15, cast: false });
    }
  }
  // Sidewalk strips along the perimeter buildings.
  for (const [x0, x1, z0, z1] of [[B.minX, B.maxX, B.minZ, B.minZ + 2.4], [B.minX, B.maxX, B.maxZ - 2.4, B.maxZ], [B.minX, B.minX + 2.4, B.minZ, B.maxZ], [B.maxX - 2.4, B.maxX, B.minZ, B.maxZ]]) {
    const w = x1 - x0, d = z1 - z0;
    const t = tex.pavers.clone(); t.repeat.set(w / 3, d / 3); t.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), stdMat({ map: t, normalMap: normalMapFor(t), roughness: 0.75 }));
    m.rotation.x = -Math.PI / 2; m.position.set((x0 + x1) / 2, 0.015, (z0 + z1) / 2); m.receiveShadow = true;
    scene.add(m);
  }

  // Planters get soil and a shrub; low walls a coping.
  const soil = new THREE.MeshStandardMaterial({ color: 0x3a2c20, roughness: 1 });
  const leaf = new THREE.MeshStandardMaterial({ color: 0x2f5a2c, roughness: 0.95, flatShading: true });
  for (const b of MAP.boxes) {
    if (b.mat !== 'concrete') continue;
    const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2, w = b.max[0] - b.min[0], d = b.max[2] - b.min[2];
    batch.place(G.box, soil, cx, b.max[1] + 0.01, cz, { sx: w - 0.2, sy: 0.02, sz: d - 0.2 });
    const n = Math.max(2, Math.round(Math.max(w, d) / 0.9));
    for (let i = 0; i < n; i++) {
      const t = (i + 0.5) / n - 0.5;
      batch.place(G.sphere, leaf, cx + (w > d ? t * w : 0), b.max[1] + 0.35, cz + (w > d ? 0 : t * d), { s: rr(0.75, 1.0) });
    }
  }

  // Custom models for vending machines and delivery trucks.
  const vendTex = [vendingTexture(205), vendingTexture(350), vendingTexture(140)];
  for (const [kind, b] of modelBoxes) {
    const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    const w = b.max[0] - b.min[0], d = b.max[2] - b.min[2], h = b.max[1] - b.min[1];
    if (kind === 'vending') {
      const alongX = w >= d;
      const n = 2, step = (alongX ? w : d) / n;
      const face = alongX ? [0, 0, -Math.sign(cz) || 1] : [-Math.sign(cx) || 1, 0, 0];
      for (let i = 0; i < n; i++) {
        const t = -((alongX ? w : d) / 2) + step * (i + 0.5);
        const px = alongX ? cx + t : cx, pz = alongX ? cz : cz + t;
        const body = new THREE.Mesh(new RoundedBoxGeometry(alongX ? step - 0.06 : w, h, alongX ? d : step - 0.06, 2, 0.04), new THREE.MeshStandardMaterial({ color: [0x2d6fa8, 0xb8262e, 0x2d8a52][i % 3], roughness: 0.4, metalness: 0.2 }));
        body.position.set(px, h / 2, pz); body.castShadow = body.receiveShadow = true; scene.add(body);
        const front = signMesh(vendTex[i % 3], (alongX ? step : step) - 0.2, h - 0.15, 0.9);
        front.position.set(px + face[0] * ((alongX ? 0 : w / 2) + 0.01), h / 2, pz + face[2] * ((alongX ? d / 2 : 0) + 0.01));
        front.rotation.y = Math.atan2(face[0], face[2]);
        scene.add(front);
      }
    } else if (kind === 'truck') {
      scene.add(buildTruck(cx, cz, w, d, h, { glassMat, tire, metalDark }));
    }
  }

  // Scooters, trash bags and boxes against the walls (visual only, out of the lanes).
  const bagMat = new THREE.MeshStandardMaterial({ color: 0x1b1c1e, roughness: 0.35 });
  const whiteBag = new THREE.MeshStandardMaterial({ color: 0xd8d6cf, roughness: 0.5 });
  for (let i = 0; i < 26; i++) {
    const side = i % 4, t = rr(-30, 30);
    const x = side === 0 ? B.minX + 0.7 : side === 1 ? B.maxX - 0.7 : t;
    const z = side === 2 ? B.minZ + 0.7 : side === 3 ? B.maxZ - 0.7 : t;
    batch.place(G.sphere, rnd() < 0.6 ? bagMat : whiteBag, x, 0.3, z, { sx: rr(0.6, 0.9), sy: rr(0.5, 0.75), sz: rr(0.6, 0.9) });
  }

  // City beyond the block: taller towers with lit windows and rooftop signs.
  skyline(surfaces, scene, { inner: 40, outer: 150, count: 70, minH: 18, maxH: 70, base: 0 });
}

function buildTruck(cx, cz, w, d, h, { glassMat, tire, metalDark }) {
  // 1-ton cab-over delivery truck: blue/white cab, flatbed with a tarp-covered load.
  const g = new THREE.Group();
  const alongX = w >= d;
  const L = alongX ? w : d, W = alongX ? d : w;
  const dir = rnd() < 0.5 ? 1 : -1;
  const paint = new THREE.MeshStandardMaterial({ color: rnd() < 0.5 ? 0x2c5aa0 : 0xe8e8e6, roughness: 0.35, metalness: 0.3 });
  const bedMat = new THREE.MeshStandardMaterial({ color: 0x9aa0a6, roughness: 0.6, metalness: 0.5 });
  const tarp = new THREE.MeshStandardMaterial({ color: rnd() < 0.5 ? 0x2b4f8f : 0x6b6f3a, roughness: 0.9 });
  const cabL = 1.7;
  const cab = new THREE.Mesh(new RoundedBoxGeometry(cabL, h * 0.86, W * 0.94, 3, 0.18), paint);
  cab.position.set(dir * (L / 2 - cabL / 2), h * 0.47, 0);
  const shield = new THREE.Mesh(new THREE.BoxGeometry(0.05, h * 0.32, W * 0.82), glassMat);
  shield.position.set(dir * (L / 2 + 0.01), h * 0.62, 0);
  const bed = new THREE.Mesh(new THREE.BoxGeometry(L - cabL - 0.1, 0.2, W), bedMat);
  bed.position.set(-dir * (cabL / 2 + 0.05), 0.8, 0);
  const load = new THREE.Mesh(new RoundedBoxGeometry(L - cabL - 0.4, h - 1.0, W * 0.88, 2, 0.2), tarp);
  load.position.set(-dir * (cabL / 2 + 0.05), 0.9 + (h - 1.0) / 2, 0);
  g.add(cab, shield, bed, load);
  for (const wx of [L / 2 - 0.9, -L / 2 + 1.0]) {
    for (const s of [-1, 1]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.28, 16), tire);
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(dir * wx, 0.38, s * (W / 2 - 0.1));
      g.add(wheel);
    }
  }
  const lamp = emissive(0xfff4dc, 2.5);
  for (const s of [-1, 1]) { const l = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.3), lamp); l.position.set(dir * (L / 2 + 0.02), 0.65, s * (W / 2 - 0.3)); g.add(l); }
  const bumper = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, W), metalDark);
  bumper.position.set(dir * (L / 2 + 0.02), 0.42, 0); g.add(bumper);
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  g.position.set(cx, 0, cz);
  if (!alongX) g.rotation.y = Math.PI / 2;
  return g;
}

/** Ring of skyline buildings (surface boxes, so they batch with the facade material). */
function skyline(surfaces, scene, { inner, outer, count, minH, maxH, base }) {
  const look = { bands: [[4.2, 'shop'], [999, 'facade']], top: 'slab' };
  const tower = emissive(0xff3050, 3);
  const clearX = MAP.bounds.maxX + 4, clearZ = MAP.bounds.maxZ + 4;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rr(-0.03, 0.03);
    const w = rr(10, 22), dd = rr(10, 22);
    let d = rr(inner, outer), x = 0, z = 0;
    for (let k = 0; k < 40; k++, d += 3) { // push outward until clear of the play area
      x = Math.cos(a) * d; z = Math.sin(a) * d;
      if (Math.abs(x) - w / 2 > clearX || Math.abs(z) - dd / 2 > clearZ) break;
    }
    const h = rr(minH, maxH) * (d > outer * 0.7 ? 1.4 : 1);
    surfaces.box({ min: [x - w / 2, base, z - dd / 2], max: [x + w / 2, base + h, z + dd / 2] }, look);
    if (rnd() < 0.3) { // aircraft warning light
      const m = new THREE.Mesh(G.sphere, tower);
      m.scale.setScalar(0.6); m.position.set(x, base + h + 0.4, z); scene.add(m);
    }
  }
}

// ─── Rooftop ──────────────────────────────────────────────────
function dressRooftop({ scene, tex, batch, surfaces, surfMat }, modelBoxes) {
  const B = MAP.bounds;
  const fence = new THREE.MeshStandardMaterial({ map: tex.fence, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.7 });
  const pipe = new THREE.MeshStandardMaterial({ color: 0x8d9296, roughness: 0.4, metalness: 0.8 });
  const parapetLook = { bands: [[99, 'concrete']], top: 'concrete' };
  const stainless = new THREE.MeshStandardMaterial({ map: tex.steel, roughness: 0.25, metalness: 0.9 });
  const acBody = new THREE.MeshStandardMaterial({ color: 0xd9d8d2, roughness: 0.55 });
  const grille = new THREE.MeshStandardMaterial({ color: 0x3b3e40, roughness: 0.6, metalness: 0.4 });

  for (const [kind, b] of modelBoxes) {
    const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
    const w = b.max[0] - b.min[0], d = b.max[2] - b.min[2], h = b.max[1] - b.min[1];
    if (kind === 'parapet') {
      // 1.1 m concrete parapet, then a chain-link safety fence up to the collision height.
      surfaces.box({ min: [b.min[0], 0, b.min[2]], max: [b.max[0], 1.1, b.max[2]] }, parapetLook);
      const alongX = w > d;
      const len = alongX ? w : d;
      const inner = alongX ? (cz < 0 ? b.max[2] : b.min[2]) : (cx < 0 ? b.max[0] : b.min[0]);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len, h - 1.1), fence.clone());
      m.material.map = tex.fence.clone();
      m.material.map.repeat.set(len / 1.2, (h - 1.1) / 1.2);
      m.material.map.needsUpdate = true;
      m.position.set(alongX ? cx : inner, 1.1 + (h - 1.1) / 2, alongX ? inner : cz);
      if (!alongX) m.rotation.y = Math.PI / 2;
      scene.add(m);
      for (let t = -len / 2; t <= len / 2; t += 3) {
        batch.place(G.cyl, pipe, alongX ? cx + t : inner, 1.1 + (h - 1.1) / 2, alongX ? inner : cz + t, { sx: 0.07, sy: h - 1.1, sz: 0.07 });
      }
      batch.place(G.cyl, pipe, alongX ? cx : inner, h, alongX ? inner : cz, { sx: 0.06, sy: len, sz: 0.06, rz: alongX ? Math.PI / 2 : 0, rx: alongX ? 0 : Math.PI / 2 });
    } else if (kind === 'rooftopUnit') {
      if (h <= 1.05) { // outdoor AC condenser
        const body = new THREE.Mesh(new RoundedBoxGeometry(w * 0.96, h, d * 0.96, 2, 0.05), acBody);
        body.position.set(cx, h / 2, cz); body.castShadow = body.receiveShadow = true; scene.add(body);
        const fan = new THREE.Mesh(new THREE.CylinderGeometry(Math.min(w, d) * 0.3, Math.min(w, d) * 0.3, 0.02, 20), grille);
        fan.position.set(cx, h + 0.01, cz); scene.add(fan);
      } else { // stainless water tank on a frame
        const body = new THREE.Mesh(new RoundedBoxGeometry(w * 0.95, h - 0.3, d * 0.95, 3, 0.25), stainless);
        body.position.set(cx, 0.3 + (h - 0.3) / 2, cz); body.castShadow = body.receiveShadow = true; scene.add(body);
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) batch.place(G.box, pipe, cx + sx * (w / 2 - 0.15), 0.15, cz + sz * (d / 2 - 0.15), { sx: 0.1, sy: 0.3, sz: 0.1 });
        for (let k = 1; k < 4; k++) batch.place(G.box, pipe, cx, 0.3 + (h - 0.3) * (k / 4), cz, { sx: w * 0.97, sy: 0.04, sz: d * 0.97 });
      }
    }
  }

  // Jangdok — a cluster of onggi earthenware jars on a raised platform, and a laundry line.
  const onggi = new THREE.MeshStandardMaterial({ color: 0x4a2c1c, roughness: 0.35, metalness: 0.05 });
  const jar = new THREE.LatheGeometry([[0, 0], [0.22, 0.02], [0.34, 0.25], [0.36, 0.42], [0.28, 0.62], [0.18, 0.66], [0.2, 0.7], [0, 0.7]].map(([x, y]) => new THREE.Vector2(x, y)), 16);
  for (let i = 0; i < 9; i++) batch.place(jar, onggi, B.maxX - 2.2 - (i % 3) * 0.85, 0, B.minZ + 2.2 + Math.floor(i / 3) * 0.85, { s: rr(0.8, 1.15) });
  const clothes = [0xd8d2c8, 0x3f6fae, 0xb53a3a, 0xe2c25a, 0x5d8f5a];
  const lineY = 2.1;
  batch.place(G.cyl, pipe, B.minX + 2, lineY / 2, B.maxZ - 2.5, { sx: 0.06, sy: lineY, sz: 0.06 });
  batch.place(G.cyl, pipe, B.minX + 9, lineY / 2, B.maxZ - 2.5, { sx: 0.06, sy: lineY, sz: 0.06 });
  batch.place(G.cyl, pipe, B.minX + 5.5, lineY, B.maxZ - 2.5, { sx: 0.015, sy: 7, sz: 0.015, rz: Math.PI / 2 });
  for (let i = 0; i < 6; i++) {
    const m = new THREE.MeshStandardMaterial({ color: clothes[i % clothes.length], roughness: 0.95, side: THREE.DoubleSide });
    batch.place(G.box, m, B.minX + 2.8 + i * 1.1, lineY - 0.4, B.maxZ - 2.5, { sx: 0.7, sy: 0.75, sz: 0.02, rz: rr(-0.05, 0.05) });
  }

  // The city around and below: the roof sits ~30 m up.
  const streets = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400), new THREE.MeshStandardMaterial({ color: 0x2a2a2e, roughness: 0.9 }));
  streets.rotation.x = -Math.PI / 2; streets.position.y = -32; scene.add(streets);
  surfaces.box({ min: [B.minX - 3, -32, B.minZ - 3], max: [B.maxX + 3, -0.02, B.maxZ + 3] }, { bands: [[4.2, 'shop'], [999, 'facade']], top: null });
  skyline(surfaces, scene, { inner: 36, outer: 120, count: 60, minH: 10, maxH: 70, base: -32 });
  // Distant ridge with a broadcast tower — a nod to Namsan.
  const ridge = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x2c3a34, roughness: 1 }));
  ridge.scale.set(140, 55, 60); ridge.position.set(-60, -32, -330); scene.add(ridge);
  const towerMat = new THREE.MeshStandardMaterial({ color: 0xd9d6cf, roughness: 0.5 });
  const t1 = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 3.2, 70, 12), towerMat); t1.position.set(-60, 53, -330);
  const t2 = new THREE.Mesh(new THREE.CylinderGeometry(7, 5, 10, 16), towerMat); t2.position.set(-60, 84, -330);
  const t3 = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 1, 40, 8), towerMat); t3.position.set(-60, 109, -330);
  const beacon = new THREE.Mesh(G.sphere, emissive(0xff2a2a, 6)); beacon.scale.setScalar(1.5); beacon.position.set(-60, 130, -330);
  scene.add(t1, t2, t3, beacon);
}
