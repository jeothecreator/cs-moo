// glTF assets: the soldier, first-person arm rigs (rifle + pistol) and the M4.
// Everything is preloaded before the first match so models can be built synchronously.
// Credits and licences: assets/models/CREDITS.txt
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';

const FILES = { soldier: 'soldier', rifleRig: 'fp_rifle', pistolRig: 'fp_pistol', m4: 'm4' };
const loaded = {};
let pending = null;

/**
 * The rifle rig is a single 11.7 s timeline; these are its actions in seconds.
 * The pistol rig ships separate clips (Take / Idle / Shoot / Reload).
 */
const RIFLE_SEGMENTS = {
  draw: [0.1, 1.9], idle: [1.9, 3.12], fire: [3.15, 3.55], reload: [4.2, 7.1], reloadEmpty: [7.6, 11.65],
};

export function preloadAssets() {
  if (pending) return pending;
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder);
  pending = Promise.all(Object.entries(FILES).map(([key, file]) => loader.loadAsync(`/assets/models/${file}.glb`)
    .then((gltf) => { loaded[key] = gltf; prepare(gltf); })
    .catch((e) => console.warn(`model ${file} failed to load — using procedural fallback`, e))))
    .then(() => { buildTemplates(); return Object.keys(loaded).length; });
  return pending;
}

export const assetsReady = () => !!loaded.soldier;

// Compiled maps (tools/vmf2map.mjs): render geometry, one mesh per surface family.
const mapScenes = {};
export function preloadMap(name) {
  return (mapScenes[name] ||= new GLTFLoader().loadAsync(`/assets/maps/${name}.glb`)
    .then((gltf) => (mapScenes[name] = gltf.scene))
    .catch((e) => { console.warn(`map ${name} failed to load`, e); delete mapScenes[name]; return null; }));
}
/** The loaded map scene (null until preloadMap resolves). */
export function mapScene(name) {
  const s = mapScenes[name];
  return s && s.isObject3D ? s : null;
}

function prepare(gltf) {
  gltf.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    if (o.isSkinnedMesh) o.frustumCulled = false; // bind-pose bounds don't follow the animation
    for (const m of [].concat(o.material)) {
      if (m.map) m.map.colorSpace = THREE.SRGBColorSpace;
      m.envMapIntensity = 1;
    }
  });
}

// ─── baking & normalising ────────────────────────────────────

const _v = new THREE.Vector3();

/** Freeze (possibly skinned) meshes in their current pose into static geometry in root space. */
function bake(root, filter) {
  root.updateMatrixWorld(true);
  const rootInv = root.matrixWorld.clone().invert();
  const out = new THREE.Group();
  root.traverse((o) => {
    if (!o.isMesh || !filter(o)) return;
    const src = o.geometry, pos = src.attributes.position;
    const arr = new Float32Array(pos.count * 3);
    const toRoot = new THREE.Matrix4().multiplyMatrices(rootInv, o.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      o.getVertexPosition(i, _v);
      _v.applyMatrix4(toRoot);
      arr[i * 3] = _v.x; arr[i * 3 + 1] = _v.y; arr[i * 3 + 2] = _v.z;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    if (src.attributes.uv) g.setAttribute('uv', src.attributes.uv);
    if (src.index) g.setIndex(src.index);
    for (const gr of src.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
    g.computeVertexNormals();
    const mat = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone();
    const mesh = new THREE.Mesh(g, mat);
    mesh.castShadow = mesh.receiveShadow = true;
    out.add(mesh);
  });
  return out;
}

function eachVertex(obj, fn) {
  obj.updateMatrixWorld(true);
  obj.traverse((o) => {
    if (!o.isMesh) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) fn(_v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld));
  });
}

/**
 * Put a gun into "gun space": barrel along -Z, up +Y, grip at the origin, scaled to `length` metres.
 * The muzzle end is found automatically (it has the thinnest cross-section).
 */
function normalizeGun(model, { length, gripFrac, boreAbove }) {
  const holder = new THREE.Group();
  holder.add(model);
  let box = new THREE.Box3().setFromObject(holder);
  let size = box.getSize(new THREE.Vector3());
  if (size.x > size.z) { model.rotation.y = Math.PI / 2; box = new THREE.Box3().setFromObject(holder); size = box.getSize(new THREE.Vector3()); }
  const end = (sign) => {
    let lo = Infinity, hi = -Infinity;
    const zEdge = sign < 0 ? box.min.z + size.z * 0.06 : box.max.z - size.z * 0.06;
    eachVertex(holder, (p) => { if (sign < 0 ? p.z < zEdge : p.z > zEdge) { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); } });
    return hi - lo;
  };
  if (end(1) < end(-1)) { model.rotation.y += Math.PI; box = new THREE.Box3().setFromObject(holder); }
  const s = length / size.z;
  model.scale.multiplyScalar(s);
  box = new THREE.Box3().setFromObject(holder);
  size = box.getSize(new THREE.Vector3());
  // bore height = centre of the muzzle tip
  let lo = Infinity, hi = -Infinity;
  eachVertex(holder, (p) => { if (p.z < box.min.z + size.z * 0.03) { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); } });
  const bore = (lo + hi) / 2;
  const cx = (box.min.x + box.max.x) / 2;
  const gripZ = box.min.z + size.z * gripFrac;
  model.position.sub(new THREE.Vector3(cx, bore - boreAbove, gripZ));
  box = new THREE.Box3().setFromObject(holder);
  holder.userData.muzzle = new THREE.Vector3(0, boreAbove, box.min.z);
  holder.userData.fore = new THREE.Vector3(0, boreAbove - 0.035, box.min.z * 0.55);
  holder.userData.sight = new THREE.Vector3(0, box.max.y, box.min.z * 0.35);
  holder.userData.length = length;
  return holder;
}

// ─── templates ────────────────────────────────────────────────

const T = { guns: {}, rigs: {} };

function poseAt(gltf, clipIndex, time) {
  const mixer = new THREE.AnimationMixer(gltf.scene);
  const a = mixer.clipAction(gltf.animations[clipIndex]);
  a.play();
  mixer.setTime(time);
  gltf.scene.updateMatrixWorld(true);
  return mixer;
}

/** Rotate a rig's root so its gun points down -Z (the muzzle end is the thinner one). */
function faceForward(root, isGun) {
  root.updateMatrixWorld(true);
  const box = new THREE.Box3(), pts = [];
  root.traverse((o) => {
    if (!o.isMesh || !isGun(o)) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 2) { o.getVertexPosition(i, _v).applyMatrix4(o.matrixWorld); box.expandByPoint(_v); pts.push(_v.clone()); }
  });
  const len = box.max.z - box.min.z;
  const span = (near) => {
    let lo = Infinity, hi = -Infinity;
    for (const p of pts) if (near(p.z)) { lo = Math.min(lo, p.y); hi = Math.max(hi, p.y); }
    return hi - lo;
  };
  if (span((z) => z > box.max.z - len * 0.08) < span((z) => z < box.min.z + len * 0.08)) {
    root.rotation.y += Math.PI;
    root.updateMatrixWorld(true);
  }
}

function buildTemplates() {
  // Third-person / icon guns, baked from the rigs at their idle pose.
  if (loaded.rifleRig) {
    const g = loaded.rifleRig;
    const isGun = (o) => o.isSkinnedMesh && o.name !== 'FPS_Hands';
    const mixer = poseAt(g, 0, RIFLE_SEGMENTS.idle[0] + 0.2);
    faceForward(g.scene, isGun);
    T.guns.scar = normalizeGun(bake(g.scene, isGun), { length: 1.0, gripFrac: 0.7, boreAbove: 0.075 });
    T.rigs.rifle = rigInfo(g, isGun, 'FPS_Hands');
    mixer.stopAllAction();
  }
  if (loaded.pistolRig) {
    const g = loaded.pistolRig;
    const idle = g.animations.findIndex((c) => /Idle/.test(c.name));
    const mixer = poseAt(g, Math.max(0, idle), 0.2);
    // Only the skinned slide/frame meshes are the gun; Plane001 / Circle004 are leftover scene props.
    const isGun = (o) => o.isSkinnedMesh && !/Hands|Sleeves/.test(o.name);
    for (const n of ['Plane001', 'Circle004_1', 'Circle004_2']) { const o = g.scene.getObjectByName(n); if (o) o.visible = false; }
    faceForward(g.scene, isGun);
    T.guns.pistol = normalizeGun(bake(g.scene, isGun), { length: 0.2, gripFrac: 0.75, boreAbove: 0.06 });
    T.rigs.pistol = rigInfo(g, isGun, 'GhostWire_Akito_Hands');
    mixer.stopAllAction();
  }
  if (loaded.m4) T.guns.m4 = normalizeGun(loaded.m4.scene.clone(true), { length: 0.86, gripFrac: 0.75, boreAbove: 0.075 });
}

/** The joint that most of a skinned mesh's vertices follow (the gun bone for a weapon mesh). */
function dominantJoint(mesh) {
  const idx = mesh.geometry.attributes.skinIndex, w = mesh.geometry.attributes.skinWeight;
  if (!idx || !mesh.skeleton) return null;
  const score = new Map();
  for (let i = 0; i < idx.count; i++) {
    for (let k = 0; k < 4; k++) {
      const j = idx.getComponent(i, k), wt = w.getComponent(i, k);
      if (wt > 0) score.set(j, (score.get(j) || 0) + wt);
    }
  }
  let best = -1, bestW = -1;
  for (const [j, wt] of score) if (wt > bestW) { best = j; bestW = wt; }
  return best >= 0 ? mesh.skeleton.bones[best].name : null;
}

/**
 * Posed gun measurements inside a rig (rig space): bounds, bore height, the bone the gun rides on,
 * and the muzzle-tip vertex so the flash can follow every animation.
 */
function rigInfo(gltf, isGun, handsName) {
  const box = new THREE.Box3();
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4(); // root has no parent: world space == the rig's parent space
  const gunMeshes = [];
  root.traverse((o) => { if (o.isMesh && isGun(o)) gunMeshes.push(o); });
  for (const o of gunMeshes) {
    const pos = o.geometry.attributes.position, m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    for (let i = 0; i < pos.count; i += 2) { o.getVertexPosition(i, _v); box.expandByPoint(_v.applyMatrix4(m)); }
  }
  const len = box.max.z - box.min.z;
  let lo = Infinity, hi = -Infinity, muzzle = null, bestZ = Infinity;
  for (const o of gunMeshes) {
    const pos = o.geometry.attributes.position, m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
    for (let i = 0; i < pos.count; i++) {
      o.getVertexPosition(i, _v).applyMatrix4(m);
      if (_v.z < box.min.z + len * 0.03) {
        lo = Math.min(lo, _v.y); hi = Math.max(hi, _v.y);
        if (_v.z < bestZ) { bestZ = _v.z; muzzle = { mesh: o.name, index: i }; }
      }
    }
  }
  const skinned = gunMeshes.find((o) => o.isSkinnedMesh);
  // Palm centres (vertices weighted mostly to each hand bone). The rear one is the grip hand.
  const hands = root.getObjectByName(handsName);
  const palms = [];
  if (hands?.isSkinnedMesh) {
    const si = hands.geometry.attributes.skinIndex, sw = hands.geometry.attributes.skinWeight;
    hands.skeleton.bones.forEach((b, idx) => {
      if (!/^hand[_]?[LR]$|^Hand[LR]$/i.test(b.name)) return;
      const acc = new THREE.Vector3(); let n = 0;
      for (let i = 0; i < si.count; i++) {
        for (let k = 0; k < 4; k++) {
          if (si.getComponent(i, k) === idx && sw.getComponent(i, k) > 0.6) { hands.getVertexPosition(i, _v).applyMatrix4(hands.matrixWorld); acc.add(_v); n++; break; }
        }
      }
      if (n) palms.push(acc.divideScalar(n));
    });
  }
  palms.sort((a, b) => b.z - a.z);
  return {
    gunBox: box, bore: (lo + hi) / 2, muzzle, gunMeshNames: gunMeshes.map((o) => o.name),
    gunBone: skinned ? dominantJoint(skinned) : null,
    gripPalm: palms[0] || null, forePalm: palms[1] || null,
  };
}

/** A static gun in gun space (see normalizeGun), or null when the model isn't available. */
export function gunModel(kind) {
  const t = T.guns[kind];
  if (!t) return null;
  const g = t.clone(true);
  g.userData = { muzzle: t.userData.muzzle.clone(), fore: t.userData.fore.clone(), sight: t.userData.sight.clone(), length: t.userData.length };
  return g;
}

/** A fresh, animatable instance of a first-person rig. */
export function rigInstance(kind) {
  const gltf = kind === 'rifle' ? loaded.rifleRig : loaded.pistolRig;
  if (!gltf || !T.rigs[kind]) return null;
  const scene = cloneSkinned(gltf.scene);
  const mixer = new THREE.AnimationMixer(scene);
  const clips = {};
  if (kind === 'rifle') {
    const full = gltf.animations[0];
    for (const [name, [a, b]] of Object.entries(RIFLE_SEGMENTS)) clips[name] = THREE.AnimationUtils.subclip(full, name, Math.round(a * 24), Math.round(b * 24), 24);
  } else {
    for (const c of gltf.animations) {
      const n = c.name.split('|').pop().toLowerCase();
      clips[{ take: 'draw', idle: 'idle', shoot: 'fire', reload: 'reload' }[n] || n] = c;
    }
  }
  return { scene, mixer, clips, info: T.rigs[kind] };
}

/** The soldier, cloned with its own skeleton. */
export function soldierInstance() {
  if (!loaded.soldier) return null;
  return cloneSkinned(loaded.soldier.scene);
}
