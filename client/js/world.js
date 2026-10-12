// Builds de_barnyard visuals: merged textured geometry, baked sun shadows, sky, skyline props.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { MAP } from '/shared/map.js';
import { boxBlocked } from '/shared/physics.js';
import { makeTextures, textTexture, normalMapFor } from './textures.js';

const MAT_SCALE = { stone: 4, barn: 3.5, concrete: 5, brick: 3, door: 4.5, crate: 0, hay: 0, metal: 2.5, tank: 3.2, wood: 3 };

export const IMPACT_COLORS = {
  stone: 0x8d877c, barn: 0x8e2b22, concrete: 0xb0aca2, brick: 0x9b4d36, door: 0x7a5a3a, crate: 0xb58a4f,
  hay: 0xe0c060, metal: 0x9fb8b0, tank: 0xdde4e8, wood: 0x9c7a52, ground: 0x7b6a4c,
};

let rseed = 7;
const rnd = () => ((rseed = (rseed * 16807) % 2147483647) - 1) / 2147483646;

function boxGeometry(b, scale) {
  const w = b.max[0] - b.min[0], h = b.max[1] - b.min[1], d = b.max[2] - b.min[2];
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      const su = scale ? dims[f][0] / scale : Math.max(1, Math.round(dims[f][0] / (b.mat === 'hay' ? 1.4 : 1)));
      const sv = scale ? dims[f][1] / scale : Math.max(1, Math.round(dims[f][1] / (b.mat === 'hay' ? 1.2 : 1)));
      uv.setXY(i, uv.getX(i) * su + (scale ? b.min[0] * 0.13 : 0), uv.getY(i) * sv);
    }
  }
  const pos = g.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const tint = 0.9 + rnd() * 0.1;
  for (let i = 0; i < pos.count; i++) {
    const bottom = pos.getY(i) < 0;
    const ao = bottom ? (b.min[1] <= 0.01 ? 0.58 : 0.8) : 1;
    colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = ao * tint;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.translate((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2);
  return g;
}

// Rayleigh/Mie atmospheric sky with volumetric clouds. Also drives the sun direction and
// the image-based lighting, so sky, sunlight and ambient all agree instead of being hand-picked.
export const SUN = { elevation: 34, azimuth: 148 };
const SKY_SCALE = 0.12;

function sunVector(elevation = SUN.elevation, azimuth = SUN.azimuth) {
  return new THREE.Vector3().setFromSphericalCoords(
    1, THREE.MathUtils.degToRad(90 - elevation), THREE.MathUtils.degToRad(azimuth));
}

function makeSky(sunDir) {
  const sky = new Sky();
  sky.scale.setScalar(12000);
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  const u = sky.material.uniforms;
  u.turbidity.value = 4.5;
  u.rayleigh.value = 1.15;
  u.mieCoefficient.value = 0.004;
  u.mieDirectionalG.value = 0.86;
  u.cloudCoverage.value = 0.45;
  u.cloudDensity.value = 0.5;
  u.cloudScale.value = 0.00022;
  u.cloudSpeed.value = 0.00003;
  u.cloudElevation.value = 0.42;
  u.sunPosition.value.copy(sunDir);

  // The atmospheric model returns raw radiance (tens of units). Left alone it swamps the
  // bloom threshold and veils the whole frame in white, so scale it into a sane HDR range.
  u.skyScale = { value: SKY_SCALE };
  sky.material.fragmentShader = 'uniform float skyScale;\n' + sky.material.fragmentShader.replace(
    'gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( texColor * skyScale, 1.0 );');
  sky.material.needsUpdate = true;
  return sky;
}

function gableRoof(b, mat, endMat) {
  const group = new THREE.Group();
  const w = b.max[0] - b.min[0], d = b.max[2] - b.min[2];
  const alongX = w >= d;
  const span = alongX ? d : w;
  const len = (alongX ? w : d) + 1.2;
  const rise = Math.min(4.5, span * 0.35);
  const half = span / 2 + 0.6;
  const slope = Math.hypot(half, rise);
  const ang = Math.atan2(rise, half);
  const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2, top = b.max[1];
  for (const side of [-1, 1]) {
    const g = new THREE.BoxGeometry(alongX ? len : slope, 0.25, alongX ? slope : len);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 3, uv.getY(i) * slope / 3);
    const m = new THREE.Mesh(g, mat);
    if (alongX) {
      m.position.set(cx, top + rise / 2 - 0.1, cz + side * half / 2);
      m.rotation.x = side * ang;
    } else {
      m.position.set(cx + side * half / 2, top + rise / 2 - 0.1, cz);
      m.rotation.z = -side * ang;
    }
    m.castShadow = true;
    group.add(m);
  }
  // gable ends
  const shape = new THREE.Shape();
  shape.moveTo(-span / 2, 0); shape.lineTo(span / 2, 0); shape.lineTo(0, rise); shape.closePath();
  const sg = new THREE.ShapeGeometry(shape);
  const uv = sg.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / 3.5, uv.getY(i) / 3.5);
  for (const end of [-1, 1]) {
    const m = new THREE.Mesh(sg, endMat);
    if (alongX) {
      m.position.set(end < 0 ? b.min[0] : b.max[0], top, cz);
      m.rotation.y = end * Math.PI / 2;
    } else {
      m.position.set(cx, top, end < 0 ? b.min[2] : b.max[2]);
      m.rotation.y = end < 0 ? Math.PI : 0;
    }
    group.add(m);
  }
  return group;
}

function makeTree(trunkMat, leafMat) {
  const g = new THREE.Group();
  const h = 8 + rnd() * 8;
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, h * 0.45, 6), trunkMat);
  trunk.position.y = h * 0.22;
  g.add(trunk);
  for (let i = 0; i < 3; i++) {
    const r = (3.2 - i * 0.8) * (0.8 + rnd() * 0.4);
    const cone = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 0), leafMat);
    cone.position.set(rnd() - 0.5, h * 0.45 + i * r * 0.9, rnd() - 0.5);
    cone.scale.y = 1.2;
    g.add(cone);
  }
  return g;
}

// Visual-only props: kept against existing walls or beyond the playable boundary.
function makePallet(mat) {
  const g = new THREE.Group();
  const board = new THREE.BoxGeometry(1.25, 0.1, 0.18);
  for (const z of [-0.42, 0, 0.42]) { const m = new THREE.Mesh(board, mat); m.position.z = z; g.add(m); }
  for (const x of [-0.48, 0.48]) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.16, 1.05), mat); m.position.set(x, -0.11, 0); g.add(m); }
  g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  return g;
}

function makeMilkCan(bodyMat, lidMat) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.75, 14), bodyMat);
  const lid = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.08, 14), lidMat);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.18, 0.025, 6, 12, Math.PI), lidMat);
  lid.position.y = 0.41; handle.position.y = 0.47; handle.rotation.y = Math.PI / 2;
  g.add(body, lid, handle);
  g.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
  return g;
}

function addBirdFlock(scene, updaters) {
  const flock = new THREE.Group();
  const mat = new THREE.MeshBasicMaterial({ color: 0x27313a, side: THREE.DoubleSide, fog: false });
  const wings = new THREE.Shape();
  wings.moveTo(-0.8, 0); wings.quadraticCurveTo(-0.35, 0.28, 0, 0); wings.quadraticCurveTo(0.35, 0.28, 0.8, 0); wings.lineTo(0, -0.08); wings.closePath();
  const geo = new THREE.ShapeGeometry(wings);
  for (let i = 0; i < 14; i++) {
    const bird = new THREE.Mesh(geo, mat);
    bird.position.set(-105 + i * 3.5, 72 + (i % 4) * 1.6, -110 + (i % 5) * 3);
    bird.rotation.y = 0.68; bird.scale.setScalar(0.7 + (i % 3) * 0.16); flock.add(bird);
  }
  scene.add(flock);
  let time = 0;
  updaters.push((dt) => { time += dt; flock.position.x = (time * 5) % 150; flock.position.z = Math.sin(time * 0.12) * 12; flock.children.forEach((bird, i) => { bird.rotation.z = Math.sin(time * 7 + i) * 0.22; }); });
}

function addUtilityPoles(scene) {
  const poleMat = stdMat({ color: 0x423d35, roughness: 0.95 });
  const wireMat = new THREE.LineBasicMaterial({ color: 0x302d29, transparent: true, opacity: 0.7 });
  const positions = [[-96, -76], [-42, -96], [20, -98], [78, -90]];
  for (let i = 0; i < positions.length; i++) {
    const [x, z] = positions[i];
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.28, 18, 7), poleMat);
    pole.position.set(x, 9, z); scene.add(pole);
    const cross = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.18, 0.18), poleMat);
    cross.position.set(x, 16.2, z); scene.add(cross);
    if (i) {
      const [px, pz] = positions[i - 1], points = [];
      for (let s = 0; s <= 10; s++) {
        const t = s / 10;
        points.push(new THREE.Vector3(THREE.MathUtils.lerp(px, x, t), 16.1 - Math.sin(t * Math.PI) * 1.25, THREE.MathUtils.lerp(pz, z, t)));
      }
      scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), wireMat));
    }
  }
}

function addCreameryBeacons(scene, updaters) {
  const baseMat = stdMat({ color: 0x2f363a, roughness: 0.45, metalness: 0.7 });
  const lights = [];
  for (const [x, z] of [[-31, -31], [31, -31], [-31, 31], [31, 31]]) {
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.16, 10), baseMat);
    const bulbMat = stdMat({ color: 0xff5c45, emissive: 0xff1608, emissiveIntensity: 1.4 });
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), bulbMat);
    base.position.set(x, 5.08, z); bulb.position.set(x, 5.23, z);
    scene.add(base, bulb); lights.push(bulbMat);
  }
  let time = 0;
  updaters.push((dt) => { time += dt; const pulse = 0.55 + 1.65 * Math.max(0, Math.sin(time * 2.2)); lights.forEach((mat, i) => { mat.emissiveIntensity = i % 2 ? pulse : Math.max(0.35, pulse - 0.75); }); });
}

// MeshStandardMaterial + the procedural normal map that belongs to its colour map.
function stdMat(opts) {
  const n = normalMapFor(opts.map);
  return new THREE.MeshStandardMaterial(n ? { normalMap: n, normalScale: new THREE.Vector2(1, 1), ...opts } : opts);
}

export function buildWorld(targetScene, renderer, { shadows = true } = {}) {
  const scene = new THREE.Group();
  targetScene.add(scene);
  const tex = makeTextures();
  const updaters = [];

  const sunDir = sunVector();
  const sky = makeSky(sunDir);
  scene.add(sky);
  targetScene.fog = new THREE.Fog(0xa8bccd, 160, 720);
  updaters.push((dt) => { sky.material.uniforms.time.value += dt * 1000; });

  // Image-based lighting generated from that same sky, so ambient colour matches the horizon.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envSky = makeSky(sunDir);
  envSky.scale.setScalar(450);
  const envScene = new THREE.Scene();
  envScene.add(envSky);
  targetScene.environment = pmrem.fromScene(envScene, 0, 1, 2000).texture;
  targetScene.environmentIntensity = 1.1;
  envSky.geometry.dispose();
  envSky.material.dispose();

  // Lights — warm key, cool sky fill. The environment map carries most of the ambient now.
  const hemi = new THREE.HemisphereLight(0x7fb5ff, 0x4a3f2e, 0.9);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffdfae, 5.2);
  sun.position.copy(sunDir).multiplyScalar(220);
  sun.target.position.set(0, 0, 0);
  scene.add(sun, sun.target);
  if (shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(4096, 4096);
    const cam = sun.shadow.camera;
    cam.left = -85; cam.right = 85; cam.top = 85; cam.bottom = -85; cam.near = 10; cam.far = 260;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.04;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.shadowMap.autoUpdate = false;
  }

  // Materials
  const mats = {};
  const std = (map, opts = {}) => stdMat({ map, roughness: 0.92, metalness: 0, vertexColors: true, ...opts });
  mats.stone = std(tex.stone);
  mats.barn = std(tex.barn);
  mats.concrete = std(tex.concrete);
  mats.brick = std(tex.brick);
  mats.door = std(tex.door);
  mats.crate = std(tex.crate, { roughness: 0.85 });
  mats.hay = std(tex.hay, { roughness: 1 });
  mats.metal = std(tex.metal, { roughness: 0.55, metalness: 0.35 });
  mats.tank = std(tex.tank, { roughness: 0.3, metalness: 0.65 });
  mats.wood = std(tex.wood);

  // Collision boxes → merged meshes per material
  const byMat = {};
  for (const b of MAP.boxes) {
    (byMat[b.mat] ||= []).push(boxGeometry(b, MAT_SCALE[b.mat]));
  }
  const collidables = [];
  for (const [mat, geos] of Object.entries(byMat)) {
    const merged = mergeGeometries(geos);
    const mesh = new THREE.Mesh(merged, mats[mat]);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.mat = mat;
    scene.add(mesh);
    collidables.push(mesh);
  }

  // Ground
  const groundTex = tex.ground;
  groundTex.repeat.set(40, 40);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), stdMat({ map: groundTex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Paved areas (sites + spawns)
  const paveTex = tex.concrete.clone();
  paveTex.needsUpdate = true;
  paveTex.repeat.set(1, 1);
  const paveMat = stdMat({ map: paveTex, roughness: 0.95, color: 0xd8d2c4 });
  for (const r of MAP.paved || []) {
    const w = r.maxX - r.minX + 6, d = r.maxZ - r.minZ + 6;
    const t = paveTex.clone(); t.repeat.set(w / 6, d / 6); t.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), paveMat.clone());
    m.material.map = t;
    m.material.normalMap = normalMapFor(t);
    m.rotation.x = -Math.PI / 2;
    m.position.set((r.minX + r.maxX) / 2, 0.012, (r.minZ + r.maxZ) / 2);
    m.receiveShadow = true;
    scene.add(m);
    if (r.name) {
    // painted letter
    const letter = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 9),
      stdMat({ map: textTexture(r.name, { color: 'rgba(214,64,40,0.85)', font: 'bold 230px Bebas Neue, Impact, sans-serif' }), transparent: true, depthWrite: false, roughness: 1 }),
    );
    letter.rotation.x = -Math.PI / 2;
    letter.position.set(r.center[0], 0.03, r.center[1]);
    letter.receiveShadow = true;
    scene.add(letter);
    // zone outline
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(r.maxX - r.minX, 0.01, r.maxZ - r.minZ)),
      new THREE.LineBasicMaterial({ color: 0xd64028, transparent: true, opacity: 0.5 }),
    );
    outline.position.set((r.minX + r.maxX) / 2, 0.04, (r.minZ + r.maxZ) / 2);
    scene.add(outline);
    }
  }

  // Roofs
  const roofMat = stdMat({ map: tex.roof, roughness: 0.85 });
  const roofEnd = stdMat({ map: tex.barn, roughness: 0.9, side: THREE.DoubleSide });
  for (const b of MAP.boxes) {
    if (b.mat === 'barn') scene.add(gableRoof(b, roofMat, roofEnd));
    if (b.mat === 'wood' && b.max[1] > 2.5) scene.add(gableRoof(b, roofMat, stdMat({ map: tex.wood, side: THREE.DoubleSide })));
  }

  // Windows on building walls
  const glass = stdMat({ color: 0x1b2530, roughness: 0.1, metalness: 0.8 });
  const frame = stdMat({ color: 0xf1eadb, roughness: 0.8 });
  const winGeo = new THREE.BoxGeometry(1.6, 1.8, 0.08);
  const frameGeo = new THREE.BoxGeometry(1.9, 2.1, 0.06);
  const crossV = new THREE.BoxGeometry(0.1, 1.8, 0.1);
  const crossH = new THREE.BoxGeometry(1.6, 0.1, 0.1);
  for (const b of MAP.boxes) {
    if (!['barn', 'concrete'].includes(b.mat) || b.max[1] < 5) continue;
    const faces = [
      { axis: 'x', v: b.max[0], n: 1 }, { axis: 'x', v: b.min[0], n: -1 },
      { axis: 'z', v: b.max[2], n: 1 }, { axis: 'z', v: b.min[2], n: -1 },
    ];
    for (const f of faces) {
      if (Math.abs(f.v) > MAP.bounds.maxX - 1) continue;
      const len = f.axis === 'x' ? b.max[2] - b.min[2] : b.max[0] - b.min[0];
      if (len < 5) continue;
      const count = Math.floor(len / 7);
      for (let i = 0; i < count; i++) {
        const t = (i + 0.5) / count;
        const g = new THREE.Group();
        for (const [geo, m, z] of [[frameGeo, frame, 0], [winGeo, glass, 0.03], [crossV, frame, 0.07], [crossH, frame, 0.07]]) {
          const mesh = new THREE.Mesh(geo, m);
          mesh.position.z = z;
          g.add(mesh);
        }
        const y = 3.6;
        if (f.axis === 'x') {
          g.position.set(f.v + f.n * 0.04, y, b.min[2] + len * t);
          g.rotation.y = f.n * Math.PI / 2;
        } else {
          g.position.set(b.min[0] + len * t, y, f.v + f.n * 0.04);
          g.rotation.y = f.n > 0 ? 0 : Math.PI;
        }
        scene.add(g);
      }
    }
  }

  // Silos & rooftop details
  const siloMat = stdMat({ map: tex.metal, roughness: 0.5, metalness: 0.4, color: 0xdfe8e6 });
  const domeMat = stdMat({ color: 0xb8c4c8, roughness: 0.35, metalness: 0.7 });
  for (const [x, z, r, h, base = 7] of MAP.silos || []) {
    const silo = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 24), siloMat);
    silo.position.set(x, base + h / 2, z);
    silo.castShadow = true;
    const dome = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), domeMat);
    dome.position.set(x, base + h, z);
    scene.add(silo, dome);
    for (let k = 1; k < 5; k++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r + 0.05, 0.08, 6, 32), domeMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.set(x, base + (h * k) / 5, z);
      scene.add(ring);
    }
  }
  if (MAP.name === 'dm_creamery') addCreameryBeacons(scene, updaters);

  // parapets on concrete blocks
  const parMat = stdMat({ map: tex.concrete, roughness: 0.9, color: 0xc9c4b8 });
  for (const b of MAP.boxes) {
    if (b.mat !== 'concrete') continue;
    const w = b.max[0] - b.min[0], d = b.max[2] - b.min[2];
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w + 0.4, 0.35, d + 0.4), parMat);
    cap.position.set((b.min[0] + b.max[0]) / 2, b.max[1] + 0.17, (b.min[2] + b.max[2]) / 2);
    cap.castShadow = true;
    scene.add(cap);
  }

  // Perimeter fence rail on stone walls
  const railMat = stdMat({ map: tex.wood, roughness: 0.9 });
  const postGeo = new THREE.BoxGeometry(0.25, 1.4, 0.25);
  const posts = new THREE.InstancedMesh(postGeo, railMat, 220);
  let pi = 0;
  const m4 = new THREE.Matrix4();
  const E = MAP.bounds.maxX, O = E + 2, WH = MAP.wallH || 9;
  for (let t = -E; t <= E; t += 4) {
    for (const [x, z] of [[t, -O], [t, O], [-O, t], [O, t]]) {
      if (pi >= 220) break;
      m4.makeTranslation(x, WH + 0.7, z);
      posts.setMatrixAt(pi++, m4);
    }
  }
  posts.count = pi;
  scene.add(posts);
  addUtilityPoles(scene);
  const L = 2 * O + 2;
  for (const [x, z, w, d] of [[0, -O, L, 0.12], [0, O, L, 0.12], [-O, 0, 0.12, L], [O, 0, 0.12, L]]) {
    for (const y of [WH + 0.6, WH + 1.2]) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(w, 0.15, d), railMat);
      r.position.set(x, y, z);
      scene.add(r);
    }
  }

  // Skyline: trees, hills, windmill
  const trunkMat = stdMat({ color: 0x4a3525, roughness: 1 });
  const leafMat = stdMat({ color: 0x4f7a3a, roughness: 1, flatShading: true });
  const leafMat2 = stdMat({ color: 0x3f6a34, roughness: 1, flatShading: true });
  for (let i = 0; i < 70; i++) {
    const a = rnd() * Math.PI * 2;
    const d = 75 + rnd() * 60;
    const t = makeTree(trunkMat, rnd() < 0.5 ? leafMat : leafMat2);
    t.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
    t.scale.setScalar(1 + rnd() * 0.6);
    scene.add(t);
  }
  const hillMat = stdMat({ color: 0x7f9a5a, roughness: 1, flatShading: true });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rnd() * 0.2;
    const d = 300 + rnd() * 120;
    const hill = new THREE.Mesh(new THREE.IcosahedronGeometry(80 + rnd() * 60, 1), hillMat);
    hill.scale.y = 0.35 + rnd() * 0.25;
    hill.position.set(Math.cos(a) * d, -20, Math.sin(a) * d);
    scene.add(hill);
  }
  {
    const wm = new THREE.Group();
    const towerMat = stdMat({ color: 0xe9e2d0, roughness: 0.8 });
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 4.2, 26, 8), towerMat);
    tower.position.y = 13;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(3.2, 5, 8), roofMat);
    cap.position.y = 28.5;
    const hub = new THREE.Group();
    hub.position.set(0, 25, 3.2);
    const bladeMat = stdMat({ map: tex.wood, roughness: 0.9 });
    for (let i = 0; i < 4; i++) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(2.2, 13, 0.15), bladeMat);
      blade.position.y = 7;
      const arm = new THREE.Group();
      arm.rotation.z = (i * Math.PI) / 2;
      arm.add(blade);
      hub.add(arm);
    }
    wm.add(tower, cap, hub);
    wm.position.set(-95, 0, 88);
    wm.rotation.y = -0.6;
    wm.traverse((o) => { if (o.isMesh) o.castShadow = false; });
    scene.add(wm);
    updaters.push((dt) => { hub.rotation.z += dt * 0.6; });
  }
  // Water tower near CT
  {
    const wt = new THREE.Group();
    const legMat = stdMat({ color: 0x5b4a3a, roughness: 0.9 });
    for (const [x, z] of [[-3, -3], [3, -3], [-3, 3], [3, 3]]) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.3, 18, 6), legMat);
      leg.position.set(x, 9, z);
      wt.add(leg);
    }
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 7, 20), stdMat({ map: tex.tank, roughness: 0.4, metalness: 0.5 }));
    tank.position.y = 21.5;
    const top = new THREE.Mesh(new THREE.ConeGeometry(5.4, 3, 20), roofMat);
    top.position.y = 26.5;
    wt.add(tank, top);
    wt.position.set(30, 0, -85);
    scene.add(wt);
  }

  // Clouds
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, fog: false });
  const clouds = new THREE.Group();
  for (let i = 0; i < 18; i++) {
    const c = new THREE.Group();
    for (let k = 0; k < 5; k++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(10 + rnd() * 14, 8, 6), cloudMat);
      s.position.set(k * 14 - 28 + rnd() * 6, rnd() * 5, rnd() * 10);
      s.scale.y = 0.45;
      c.add(s);
    }
    const a = rnd() * Math.PI * 2, d = 250 + rnd() * 350;
    c.position.set(Math.cos(a) * d, 140 + rnd() * 80, Math.sin(a) * d);
    clouds.add(c);
  }
  scene.add(clouds);
  updaters.push((dt) => { clouds.rotation.y += dt * 0.002; });
  addBirdFlock(scene, updaters);

  // Decorative small props hugging walls (visual only)
  const canMat = stdMat({ color: 0xcfd6dc, roughness: 0.3, metalness: 0.8 });
  const canGeo = new THREE.CylinderGeometry(0.22, 0.26, 0.7, 12);
  const canSpots = [[-45.6, 0, 12], [-45.6, 0, 13], [45.6, 0, 22], [45.6, 0, 21.4], [-7.6, 0, 40], [7.6, 0, 16], [-21.6, 0, -40], [21.6, 0, -35]];
  for (const [x, , z] of MAP.name === 'de_barnyard' ? canSpots : []) {
    const c = new THREE.Mesh(canGeo, canMat);
    c.position.set(x, 0.35, z);
    c.castShadow = true;
    scene.add(c);
  }
  // Signage
  const signMat = (txt, color) => stdMat({ map: textTexture(txt, { color, font: 'bold 120px Bebas Neue, Impact, sans-serif' }), transparent: true, roughness: 1 });
  const signs = [
    ['A', [-23.9, 3.2, -35], -Math.PI / 2, 'rgba(230,230,230,0.9)'],
    ['B', [21.9, 3.2, -30], Math.PI / 2, 'rgba(230,230,230,0.9)'],
    ['A →', [-24, 3, -4.1], -Math.PI / 2, 'rgba(240,210,90,0.9)'],
    ['← B', [8, 3, -5.9], Math.PI / 2, 'rgba(240,210,90,0.9)'],
    ['MID', [0, 3.5, -11.05], Math.PI, 'rgba(240,240,240,0.85)'],
  ];
  for (const [txt, p, rotY, color] of MAP.name === 'de_barnyard' ? signs : []) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), signMat(txt, color));
    m.position.set(...p);
    m.rotation.y = rotY;
    scene.add(m);
  }

  // Branded delivery clutter gives both arenas an everyday purpose without affecting routes.
  {
    const propWood = stdMat({ map: tex.wood, roughness: 0.9 });
    const propMetal = stdMat({ color: 0xd9e0df, roughness: 0.28, metalness: 0.8 });
    const propLid = stdMat({ color: 0x42515a, roughness: 0.35, metalness: 0.75 });
    const addPalletStack = (x, z, turn = 0, levels = 1) => {
      for (let i = 0; i < levels; i++) {
        const pallet = makePallet(propWood);
        pallet.position.set(x + (i % 2 ? 0.08 : 0), 0.14 + i * 0.3, z);
        pallet.rotation.y = turn + (i % 2 ? Math.PI / 2 : 0); scene.add(pallet);
      }
    };
    const addCans = (x, z, count = 2) => {
      for (let i = 0; i < count; i++) {
        const can = makeMilkCan(propMetal, propLid);
        can.position.set(x + i * 0.44, 0.38, z + (i % 2) * 0.08); can.rotation.y = i * 0.7; scene.add(can);
      }
    };
    if (MAP.name === 'dm_creamery') {
      const brand = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.4), stdMat({ map: textTexture('MOO  CREAMERY', { color: 'rgba(239,246,238,0.95)', font: 'bold 72px Bebas Neue, Impact, sans-serif' }), transparent: true, roughness: 0.75 }));
      brand.position.set(0, 5.15, -34.82); brand.rotation.y = Math.PI; scene.add(brand);
      const delivery = new THREE.Mesh(new THREE.PlaneGeometry(5.6, 1.2), stdMat({ map: textTexture('MILK  DELIVERY  →', { color: 'rgba(242,193,78,0.92)', font: 'bold 48px Bebas Neue, Impact, sans-serif' }), transparent: true, roughness: 0.8 }));
      delivery.position.set(-34.82, 3.05, -9); delivery.rotation.y = Math.PI / 2; scene.add(delivery);
      addPalletStack(-33.8, 17.5, Math.PI / 2, 2); addPalletStack(33.8, -17.5, -Math.PI / 2, 1);
      addCans(-33.9, 15.9, 3); addCans(33.85, -15.8, 2);
    } else {
      addPalletStack(-61.1, -29.2, Math.PI / 2, 2); addPalletStack(61.1, 14.5, -Math.PI / 2, 1);
      addCans(-61.05, -31, 3); addCans(61.05, 12.9, 2);
    }
  }

  // ── Detail pass: base trims, wall coping, wall lamps, barrels, grass ──
  {
    const trimGeos = [], capGeos = [];
    for (const b of MAP.boxes) {
      const w = b.max[0] - b.min[0], d = b.max[2] - b.min[2], h = b.max[1] - b.min[1];
      const cx = (b.min[0] + b.max[0]) / 2, cz = (b.min[2] + b.max[2]) / 2;
      if (h >= 4 && b.min[1] === 0) {
        const g = new THREE.BoxGeometry(w + 0.1, 0.45, d + 0.1);
        g.translate(cx, 0.225, cz);
        trimGeos.push(g);
      }
      if (b.mat === 'brick' || b.mat === 'stone' || b.mat === 'door') {
        const g = new THREE.BoxGeometry(w + 0.2, 0.22, d + 0.2);
        g.translate(cx, b.max[1] + 0.11, cz);
        capGeos.push(g);
      }
    }
    const trim = new THREE.Mesh(mergeGeometries(trimGeos), stdMat({ color: 0x57524a, roughness: 0.95 }));
    trim.receiveShadow = true;
    const cap = new THREE.Mesh(mergeGeometries(capGeos), stdMat({ color: 0x9b968b, roughness: 0.9 }));
    cap.castShadow = true;
    scene.add(trim, cap);

    const poleMat = stdMat({ color: 0x2d3035, roughness: 0.45, metalness: 0.7 });
    const shadeMat = stdMat({ color: 0x2f5a3e, roughness: 0.5, metalness: 0.4, side: THREE.DoubleSide });
    const bulbMat = stdMat({ color: 0xfff3d6, emissive: 0xffd89a, emissiveIntensity: 2.5 });
    const lamps = MAP.decor?.lamps || [];
    for (const [x, z, nx, nz] of lamps) {
      const g = new THREE.Group();
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.06), poleMat);
      plate.position.set(0, 0, 0.03);
      const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.7, 8), poleMat);
      arm.rotation.x = Math.PI / 2;
      arm.position.set(0, 0.1, 0.35);
      const shade = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.22, 16, 1, true), shadeMat);
      shade.position.set(0, 0.02, 0.7);
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 8), bulbMat);
      bulb.position.set(0, -0.06, 0.7);
      g.add(plate, arm, shade, bulb);
      g.position.set(x, 4.3, z);
      g.rotation.y = Math.atan2(nx, nz);
      g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      scene.add(g);
    }

    const barrelGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.95, 18);
    const ringGeo = new THREE.TorusGeometry(0.305, 0.02, 6, 20);
    const barrelMats = [0x2f6fd0, 0xb3261e, 0x6b4a2e].map((c) => stdMat({ color: c, roughness: 0.55, metalness: 0.45 }));
    const barrels = MAP.decor?.barrels || [];
    barrels.forEach(([x, z], i) => {
      const mat = barrelMats[i % barrelMats.length];
      const b = new THREE.Mesh(barrelGeo, mat);
      b.position.set(x, 0.475, z);
      b.castShadow = true;
      scene.add(b);
      for (const y of [0.2, 0.75]) {
        const r = new THREE.Mesh(ringGeo, poleMat);
        r.rotation.x = Math.PI / 2;
        r.position.set(x, y, z);
        scene.add(r);
      }
    });

    const gc = document.createElement('canvas');
    gc.width = gc.height = 64;
    const gctx = gc.getContext('2d');
    for (let i = 0; i < 26; i++) {
      const x = 4 + Math.random() * 56;
      gctx.strokeStyle = `rgb(${80 + Math.random() * 40},${110 + Math.random() * 40},${40 + Math.random() * 20})`;
      gctx.lineWidth = 2;
      gctx.beginPath();
      gctx.moveTo(x, 64);
      gctx.quadraticCurveTo(x + (Math.random() - 0.5) * 10, 40, x + (Math.random() - 0.5) * 18, 8 + Math.random() * 30);
      gctx.stroke();
    }
    const grassTex = new THREE.CanvasTexture(gc);
    grassTex.colorSpace = THREE.SRGBColorSpace;
    const tuftGeos = [0, Math.PI / 3, (2 * Math.PI) / 3].map((a) => {
      const p = new THREE.PlaneGeometry(0.5, 0.4);
      p.translate(0, 0.2, 0);
      p.rotateY(a);
      return p;
    });
    const tuft = mergeGeometries(tuftGeos);
    const grassMat = stdMat({ map: grassTex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1 });
    const COUNT = 1100;
    const grass = new THREE.InstancedMesh(tuft, grassMat, COUNT);
    const tall = MAP.boxes.filter((b) => b.max[1] >= 2);
    const mtx = new THREE.Matrix4();
    let n = 0;
    for (let tries = 0; tries < COUNT * 4 && n < COUNT; tries++) {
      const b = tall[Math.floor(rnd() * tall.length)];
      const face = Math.floor(rnd() * 4);
      const off = 0.1 + rnd() * 0.35;
      let x, z;
      if (face === 0) { x = b.min[0] - off; z = b.min[2] + rnd() * (b.max[2] - b.min[2]); }
      else if (face === 1) { x = b.max[0] + off; z = b.min[2] + rnd() * (b.max[2] - b.min[2]); }
      else if (face === 2) { z = b.min[2] - off; x = b.min[0] + rnd() * (b.max[0] - b.min[0]); }
      else { z = b.max[2] + off; x = b.min[0] + rnd() * (b.max[0] - b.min[0]); }
      if (Math.abs(x) > MAP.bounds.maxX - 0.2 || Math.abs(z) > MAP.bounds.maxZ - 0.2 || boxBlocked(x, 0.05, z, 0.05, 0.3)) continue;
      const s = 0.6 + rnd() * 0.9;
      mtx.makeRotationY(rnd() * 6.28);
      mtx.scale(new THREE.Vector3(s, s * (0.8 + rnd() * 0.6), s));
      mtx.setPosition(x, 0, z);
      grass.setMatrixAt(n++, mtx);
    }
    grass.count = n;
    scene.add(grass);
  }

  if (shadows) renderer.shadowMap.needsUpdate = true;

  return {
    tex,
    collidables,
    sun,
    sky,
    hemi,
    update(dt) { for (const u of updaters) u(dt); },
    refreshShadows() { if (shadows) renderer.shadowMap.needsUpdate = true; },
    dispose() {
      targetScene.remove(scene);
      scene.traverse((o) => { o.geometry?.dispose?.(); });
    },
  };
}
