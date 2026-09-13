// Third-person cow operators: rounded tactical models with procedural walk / crouch / aim / death animation.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { buildWeaponMesh, SMALL_ITEMS } from './viewmodel.js';

const GEO = new Map();
const geo = (key, make) => {
  if (!GEO.has(key)) GEO.set(key, make());
  return GEO.get(key);
};
const rbox = (w, h, d, r) => geo(`rb:${w}:${h}:${d}:${r}`, () => new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2.05, h / 2.05, d / 2.05)));
const caps = (r, len, seg = 12) => geo(`cap:${r}:${len}`, () => new THREE.CapsuleGeometry(r, len, 5, seg));
const sphere = (r, w = 16, h = 12) => geo(`sp:${r}`, () => new THREE.SphereGeometry(r, w, h));

let shared = null;
function sharedAssets(tex) {
  if (shared) return shared;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(0,0,0,0.5)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const std = (o) => new THREE.MeshStandardMaterial(o);
  shared = {
    blobMat: new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }),
    T: {
      fur: std({ map: tex.bull, roughness: 0.95 }),
      furDark: std({ color: 0x3d2414, roughness: 0.95 }),
      vest: std({ map: tex.camoT, roughness: 0.8 }),
      pants: std({ color: 0x6b5a40, roughness: 0.9 }),
      accent: std({ color: 0xb3261e, roughness: 0.7 }),
      patch: std({ color: 0xe0a340, roughness: 0.6, emissive: 0x201000 }),
    },
    CT: {
      fur: std({ map: tex.holstein, roughness: 0.9 }),
      furDark: std({ color: 0x1a1a1c, roughness: 0.9 }),
      vest: std({ map: tex.camoCT, roughness: 0.8 }),
      pants: std({ color: 0x2c3a4e, roughness: 0.9 }),
      accent: std({ color: 0x2f5d9e, roughness: 0.45, metalness: 0.3 }),
      patch: std({ color: 0x5d9cec, roughness: 0.6, emissive: 0x001020 }),
    },
    snout: std({ color: 0xe9a3aa, roughness: 0.55 }),
    nostril: std({ color: 0x5a2f35, roughness: 0.6 }),
    boot: std({ color: 0x1e1f22, roughness: 0.75 }),
    sole: std({ color: 0x0e0e0f, roughness: 0.9 }),
    strap: std({ color: 0x2b2c2f, roughness: 0.8 }),
    glove: std({ color: 0x1f2124, roughness: 0.8 }),
    pad: std({ color: 0x33363b, roughness: 0.6 }),
    horn: std({ color: 0xece2c8, roughness: 0.45 }),
    hornTip: std({ color: 0x4a4036, roughness: 0.4 }),
    eyeW: std({ color: 0xffffff, roughness: 0.2 }),
    eyeB: std({ color: 0x101012, roughness: 0.1, metalness: 0.2 }),
    earIn: std({ color: 0xd98b95, roughness: 0.7 }),
    gold: std({ color: 0xd9a531, roughness: 0.25, metalness: 0.9 }),
    visor: std({ color: 0x1a2a3a, roughness: 0.05, metalness: 0.8 }),
    buckle: std({ color: 0x8f959c, roughness: 0.3, metalness: 0.9 }),
    bomb: std({ color: 0xf5f5f0, roughness: 0.45 }),
    led: new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false }),
  };
  return shared;
}

function mesh(g, m, x = 0, y = 0, z = 0) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  return o;
}

function hornGeometry(side) {
  return geo(`horn:${side}`, () => {
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, 0),
      new THREE.Vector3(side * 0.09, 0.03, -0.01),
      new THREE.Vector3(side * 0.15, 0.11, -0.04),
      new THREE.Vector3(side * 0.15, 0.19, -0.08),
    ]);
    const g = new THREE.TubeGeometry(curve, 16, 0.028, 10, false);
    // taper towards the tip
    const pos = g.attributes.position;
    const pts = curve.getSpacedPoints(16);
    for (let i = 0; i < pos.count; i++) {
      const seg = Math.floor(i / 11);
      const t = seg / 16;
      const c = pts[Math.min(16, seg)];
      const k = 1 - t * 0.8;
      pos.setXYZ(i, c.x + (pos.getX(i) - c.x) * k, c.y + (pos.getY(i) - c.y) * k, c.z + (pos.getZ(i) - c.z) * k);
    }
    g.computeVertexNormals();
    return g;
  });
}

export class CowModel {
  constructor(team, tex) {
    const A = sharedAssets(tex);
    const P = A[team];
    this.team = team;
    this.root = new THREE.Group();
    this.pose = new THREE.Group();
    this.root.add(this.pose);

    const blob = new THREE.Mesh(geo('blob', () => new THREE.PlaneGeometry(1.1, 1.1)), A.blobMat);
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.02;
    this.root.add(blob);
    this.blob = blob;

    // ── hips & legs ──
    this.hips = new THREE.Group();
    this.hips.position.y = 0.9;
    this.pose.add(this.hips);
    this.hips.add(mesh(rbox(0.44, 0.22, 0.3, 0.07), P.pants));
    this.hips.add(mesh(rbox(0.47, 0.06, 0.33, 0.025), A.strap, 0, 0.09, 0));
    this.hips.add(mesh(rbox(0.07, 0.05, 0.02, 0.01), A.buckle, 0, 0.09, -0.17));
    this.hips.add(mesh(rbox(0.09, 0.12, 0.08, 0.02), A.strap, 0.2, -0.02, 0.02));

    this.legs = [];
    for (const side of [-1, 1]) {
      const thigh = new THREE.Group();
      thigh.position.set(side * 0.13, -0.04, 0);
      thigh.add(mesh(caps(0.1, 0.26), P.pants, 0, -0.22, 0));
      thigh.add(mesh(rbox(0.07, 0.1, 0.13, 0.02), A.strap, side * 0.1, -0.2, 0));
      const shin = new THREE.Group();
      shin.position.y = -0.45;
      shin.add(mesh(rbox(0.14, 0.12, 0.08, 0.035), A.pad, 0, 0.0, -0.09));
      shin.add(mesh(caps(0.085, 0.2), P.pants, 0, -0.15, 0));
      shin.add(mesh(rbox(0.19, 0.16, 0.3, 0.05), A.boot, 0, -0.37, -0.04));
      shin.add(mesh(rbox(0.2, 0.04, 0.31, 0.015), A.sole, 0, -0.44, -0.04));
      thigh.add(shin);
      this.hips.add(thigh);
      this.legs.push({ thigh, shin, side });
    }

    // ── torso ──
    this.torso = new THREE.Group();
    this.torso.position.y = 0.06;
    this.hips.add(this.torso);
    this.torso.add(mesh(rbox(0.54, 0.6, 0.36, 0.13), P.fur, 0, 0.3, 0));
    this.torso.add(mesh(rbox(0.6, 0.44, 0.42, 0.07), P.vest, 0, 0.27, 0));
    for (const x of [-0.16, 0, 0.16]) this.torso.add(mesh(rbox(0.13, 0.13, 0.06, 0.02), P.vest, x, 0.16, -0.23));
    for (const x of [-0.19, 0.19]) {
      this.torso.add(mesh(rbox(0.09, 0.08, 0.46, 0.02), A.strap, x, 0.5, 0));
    }
    this.torso.add(mesh(rbox(0.15, 0.07, 0.02, 0.01), P.patch, 0.14, 0.4, -0.215));
    this.torso.add(mesh(rbox(0.46, 0.08, 0.34, 0.04), P.fur, 0, 0.56, 0));
    if (team === 'T') {
      this.torso.add(mesh(rbox(0.4, 0.09, 0.38, 0.04), P.accent, 0, 0.6, 0));
    }

    // tail
    const tail = new THREE.Group();
    tail.position.set(0, -0.02, 0.16);
    tail.rotation.x = 0.35;
    tail.add(mesh(caps(0.018, 0.42, 6), P.fur, 0, -0.24, 0));
    tail.add(mesh(sphere(0.05, 8, 6), P.furDark, 0, -0.48, 0));
    this.hips.add(tail);
    this.tail = tail;

    // backpack bomb
    this.pack = new THREE.Group();
    this.pack.add(mesh(rbox(0.28, 0.34, 0.17, 0.06), A.bomb));
    this.pack.add(mesh(rbox(0.16, 0.1, 0.02, 0.01), A.strap, 0, 0.05, 0.09));
    const led = new THREE.Mesh(sphere(0.02, 8, 6), A.led);
    led.position.set(0.05, 0.06, 0.1);
    this.pack.add(led);
    this.packLed = led;
    this.pack.position.set(0, 0.3, 0.29);
    this.pack.visible = false;
    this.torso.add(this.pack);

    // ── head ──
    this.head = new THREE.Group();
    this.head.position.y = 0.62;
    this.torso.add(this.head);
    this.head.add(mesh(caps(0.1, 0.06), P.fur, 0, 0.0, 0));
    this.head.add(mesh(rbox(0.36, 0.34, 0.4, 0.12), P.fur, 0, 0.15, 0));
    this.head.add(mesh(rbox(0.33, 0.2, 0.18, 0.08), A.snout, 0, 0.06, -0.25));
    for (const s of [-1, 1]) {
      const nos = mesh(sphere(0.026, 10, 8), A.nostril, s * 0.07, 0.085, -0.335);
      nos.scale.set(1, 0.6, 0.5);
      this.head.add(nos);
      this.head.add(mesh(sphere(0.052), A.eyeW, s * 0.115, 0.2, -0.18));
      this.head.add(mesh(sphere(0.028, 10, 8), A.eyeB, s * 0.12, 0.2, -0.225));
      this.head.add(mesh(sphere(0.008, 6, 4), A.eyeW, s * 0.11, 0.212, -0.25));
      const brow = mesh(rbox(0.1, 0.025, 0.05, 0.01), P.furDark, s * 0.11, 0.265, -0.19);
      brow.rotation.z = s * -0.15;
      this.head.add(brow);
      const ear = new THREE.Group();
      ear.position.set(s * 0.2, 0.21, 0.05);
      ear.rotation.z = s * 1.2;
      const earMesh = mesh(caps(0.045, 0.1, 8), P.fur, 0, 0.08, 0);
      earMesh.scale.z = 0.45;
      const inner = mesh(caps(0.03, 0.07, 8), A.earIn, 0, 0.08, -0.02);
      inner.scale.z = 0.3;
      ear.add(earMesh, inner);
      this.head.add(ear);
      const horn = mesh(hornGeometry(s), A.horn, s * 0.15, 0.3, 0.02);
      this.head.add(horn);
    }
    this.head.add(mesh(rbox(0.16, 0.012, 0.02, 0.005), A.nostril, 0, 0.0, -0.335));
    if (team === 'T') {
      const ring = new THREE.Mesh(geo('ring', () => new THREE.TorusGeometry(0.045, 0.01, 8, 18)), A.gold);
      ring.position.set(0, 0.0, -0.345);
      this.head.add(ring);
      this.head.add(mesh(rbox(0.39, 0.07, 0.43, 0.03), P.accent, 0, 0.27, 0.0));
      const knot = mesh(rbox(0.06, 0.1, 0.03, 0.01), P.accent, 0.0, 0.26, 0.23);
      knot.rotation.x = 0.4;
      this.head.add(knot);
    } else {
      const helmet = mesh(geo('helmet', () => new THREE.SphereGeometry(0.245, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2)), P.accent, 0, 0.26, 0.02);
      helmet.scale.set(1, 0.72, 1.06);
      this.head.add(helmet);
      const rim = new THREE.Mesh(geo('rim', () => new THREE.TorusGeometry(0.245, 0.018, 8, 28)), P.accent);
      rim.rotation.x = Math.PI / 2;
      rim.scale.set(1, 1.06, 1);
      rim.position.set(0, 0.265, 0.02);
      this.head.add(rim);
      for (const s of [-1, 1]) {
        const lens = mesh(geo('goggle', () => new THREE.CylinderGeometry(0.045, 0.045, 0.03, 16)), A.visor, s * 0.06, 0.33, -0.17);
        lens.rotation.x = Math.PI / 2 - 0.6;
        this.head.add(lens);
        this.head.add(mesh(rbox(0.05, 0.1, 0.09, 0.03), A.strap, s * 0.24, 0.16, 0.0));
      }
    }

    // ── aim group ──
    this.aim = new THREE.Group();
    this.aim.position.set(0, 0.48, 0);
    this.torso.add(this.aim);
    this.armMats = { sleeve: P.vest, fur: P.fur, glove: A.glove, pad: A.pad };
    this.weaponId = null;
    this.gun = null;
    this.arms = new THREE.Group();
    this.aim.add(this.arms);

    this.walkPhase = Math.random() * 6;
    this.dead = false;
    this.deathT = 0;
    this.deathSide = 1;
  }

  setWeapon(id) {
    if (id === this.weaponId) return;
    this.weaponId = id;
    if (this.gun) this.aim.remove(this.gun);
    this.aim.remove(this.arms);
    this.arms = new THREE.Group();
    this.aim.add(this.arms);
    this.gun = buildWeaponMesh(id || 'udder9');
    const small = SMALL_ITEMS.has(id);
    this.gun.position.set(0.14, -0.06, small ? -0.5 : -0.3);
    this.gun.scale.setScalar(1.15);
    this.gun.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.aim.add(this.gun);
    const hand = this.gun.position.clone().add(new THREE.Vector3(0, -0.03, 0.02));
    const fore = small ? hand.clone().add(new THREE.Vector3(-0.06, -0.02, 0.03)) : this.gun.position.clone().add(this.gun.userData.fore.clone().multiplyScalar(1.15)).add(new THREE.Vector3(0, -0.03, 0));
    this.addArm(new THREE.Vector3(0.32, 0, 0.02), hand);
    this.addArm(new THREE.Vector3(-0.32, 0, 0.02), fore);
  }

  addArm(shoulder, hand) {
    const dir = new THREE.Vector3().subVectors(hand, shoulder);
    const len = dir.length();
    const g = new THREE.Group();
    const upper = mesh(caps(0.07, Math.max(0.01, len - 0.14), 10), this.armMats.sleeve, 0, len / 2, 0);
    const pad = mesh(rbox(0.16, 0.12, 0.16, 0.05), this.armMats.pad, 0, 0.03, 0);
    const glove = mesh(rbox(0.1, 0.1, 0.1, 0.035), this.armMats.glove, 0, len, 0);
    g.add(upper, pad, glove);
    g.position.copy(shoulder);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
    this.arms.add(g);
  }

  muzzleWorld(out = new THREE.Vector3()) {
    if (this.gun?.userData.muzzle) {
      out.copy(this.gun.userData.muzzle);
      return this.gun.localToWorld(out);
    }
    return this.head.getWorldPosition(out);
  }

  kill() {
    this.dead = true;
    this.deathT = 0;
    this.deathSide = Math.random() < 0.5 ? -1 : 1;
    this.pack.visible = false;
  }

  revive() {
    this.dead = false;
    this.deathT = 0;
    this.pose.rotation.set(0, 0, 0);
    this.pose.position.set(0, 0, 0);
    this.blob.visible = true;
  }

  update(dt, s) {
    const t = performance.now() / 1000;
    if (this.dead) {
      this.deathT = Math.min(1, this.deathT + dt / 0.55);
      const e = 1 - Math.pow(1 - this.deathT, 2);
      const bounce = this.deathT >= 1 ? 0 : Math.sin(this.deathT * Math.PI) * 0.15;
      this.pose.rotation.z = this.deathSide * e * Math.PI / 2;
      this.pose.position.y = 0.22 * e + bounce;
      for (const l of this.legs) {
        l.thigh.rotation.x = 0;
        l.thigh.rotation.z = l.side * 0.25 * e;
        l.shin.rotation.x = 0;
      }
      this.aim.rotation.x = -0.6 * e;
      this.head.rotation.x = 0.3 * e;
      this.blob.visible = false;
      return;
    }
    const crouch = s.crouch || 0;
    const speed = s.speed || 0;
    const k = Math.min(1, speed / 5);
    this.walkPhase += dt * (3 + speed * 1.8) * (speed > 0.2 ? 1 : 0);
    const swing = Math.sin(this.walkPhase) * 0.7 * k;

    this.hips.position.y = 0.9 - crouch * 0.42 + Math.abs(Math.cos(this.walkPhase)) * 0.035 * k;
    for (const l of this.legs) {
      const ph = l.side > 0 ? swing : -swing;
      let thigh = crouch * 1.15 + ph * (1 - crouch * 0.5);
      let shin = -crouch * 1.9 - Math.max(0, ph) * 0.9;
      if (!s.onGround) { thigh = 0.6; shin = -1.1; }
      l.thigh.rotation.x = thigh;
      l.thigh.rotation.z = 0;
      l.shin.rotation.x = shin;
    }
    this.torso.rotation.x = -crouch * 0.22 + Math.sin(this.walkPhase * 2) * 0.02 * k;
    this.torso.rotation.y = Math.sin(this.walkPhase) * 0.05 * k;
    const pitch = s.pitch || 0;
    this.aim.rotation.x = pitch + crouch * 0.22;
    this.head.rotation.x = pitch * 0.5 + crouch * 0.18;
    this.tail.rotation.z = Math.sin(t * 2.2 + this.walkPhase) * 0.25;
    this.pack.visible = !!s.bomb;
    this.packLed.visible = Math.sin(t * 8) > 0;
    this.aim.rotation.z = s.reloading ? -0.4 : 0;
    if (s.using) this.aim.rotation.x = -0.9;
  }
}
