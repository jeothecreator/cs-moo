// Third-person operators: the rigged soldier, driven procedurally — walk cycle and crouch on the
// legs, aim pitch through the spine, and two-bone IK that keeps both hands on the held weapon.
import * as THREE from 'three';
import { soldierInstance } from './assets.js';
import { buildWeaponMesh, SMALL_ITEMS } from './viewmodel.js';

const HEIGHT = 1.85; // standing height; puts the head where the head hitbox is (~1.6 m)
const TEAM_TINT = { T: new THREE.Color(0xd8c6a2), CT: new THREE.Color(0x9fb3cc), FFA: new THREE.Color(0xffffff) };

const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), v4 = new THREE.Vector3();
const q1 = new THREE.Quaternion(), q2 = new THREE.Quaternion(), q3 = new THREE.Quaternion();

/** Rotate `bone` (in world space) so the direction bone→`from` turns to bone→`to`. */
function aimBone(bone, from, to) {
  const p = bone.getWorldPosition(v1);
  const a = v2.subVectors(from, p);
  const b = v3.subVectors(to, p);
  if (a.lengthSq() < 1e-10 || b.lengthSq() < 1e-10) return;
  q1.setFromUnitVectors(a.normalize(), b.normalize());
  bone.getWorldQuaternion(q2);
  q1.multiply(q2); // new world rotation
  bone.parent.getWorldQuaternion(q3).invert();
  bone.quaternion.copy(q3.multiply(q1));
  bone.updateMatrixWorld(true);
}

/** Analytic two-bone IK: place `hand` at `target`, bending the elbow toward `pole`. */
function solveArm(upper, lower, hand, target, pole) {
  const S = upper.getWorldPosition(new THREE.Vector3());
  const E = lower.getWorldPosition(new THREE.Vector3());
  const H = hand.getWorldPosition(new THREE.Vector3());
  const a = S.distanceTo(E), b = E.distanceTo(H);
  const toT = new THREE.Vector3().subVectors(target, S);
  const c = THREE.MathUtils.clamp(toT.length(), Math.abs(a - b) + 1e-3, a + b - 1e-3);
  const dir = toT.normalize();
  const x = (a * a - b * b + c * c) / (2 * c);
  const h = Math.sqrt(Math.max(0, a * a - x * x));
  const bend = new THREE.Vector3().subVectors(pole, S);
  bend.addScaledVector(dir, -bend.dot(dir)).normalize();
  const elbow = S.clone().addScaledVector(dir, x).addScaledVector(bend, h);
  aimBone(upper, E, elbow);
  aimBone(lower, hand.getWorldPosition(v4).clone(), S.clone().addScaledVector(dir, c));
}

// Box3.setFromObject() reports a skinned mesh's bind-pose bounds in its own (mismatched) units,
// so measure the height from actual skinned vertex positions — once, it's the same for everyone.
let SCALE = 0;
function bodyScale(body) {
  if (SCALE) return SCALE;
  body.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  let lo = Infinity, hi = -Infinity;
  body.traverse((o) => {
    if (!o.isSkinnedMesh) return;
    const pos = o.geometry.attributes.position;
    for (let i = 0; i < pos.count; i += 7) {
      o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld);
      lo = Math.min(lo, v.y); hi = Math.max(hi, v.y);
    }
  });
  SCALE = HEIGHT / Math.max(1e-3, hi - lo);
  return SCALE;
}

let blobMat = null;
function shadowBlob() {
  if (!blobMat) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
    blobMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false });
  }
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), blobMat);
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.02;
  return m;
}

export class SoldierModel {
  constructor(team) {
    this.team = team;
    this.root = new THREE.Group();
    this.pose = new THREE.Group();
    this.root.add(this.pose);
    this.blob = shadowBlob();
    this.root.add(this.blob);

    this.body = soldierInstance();
    this.ok = !!this.body;
    if (this.ok) {
      this.body.scale.setScalar(bodyScale(this.body));
      this.body.rotation.y = Math.PI; // the model faces +Z; players face -Z at yaw 0
      this.pose.add(this.body);
      const tint = TEAM_TINT[team] || TEAM_TINT.FFA;
      this.body.traverse((o) => {
        if (!o.isMesh) return;
        o.material = o.material.clone();
        o.material.color.copy(tint);
        o.castShadow = true;
      });
      const find = (part) => {
        let hit = null;
        this.body.traverse((o) => { if (!hit && o.isBone && o.name.replace(/[:_]/g, '').toLowerCase().includes(part.toLowerCase())) hit = o; });
        return hit;
      };
      this.bones = {
        hips: find('mixamorigHips'), spine: find('mixamorigSpine0'), spine1: find('mixamorigSpine1'), spine2: find('mixamorigSpine2'),
        neck: find('mixamorigNeck'), head: find('mixamorigHead0'),
        lUpLeg: find('mixamorigLeftUpLeg'), lLeg: find('mixamorigLeftLeg'), lFoot: find('mixamorigLeftFoot'),
        rUpLeg: find('mixamorigRightUpLeg'), rLeg: find('mixamorigRightLeg'), rFoot: find('mixamorigRightFoot'),
        lArm: find('mixamorigLeftArm'), lFore: find('mixamorigLeftForeArm'), lHand: find('mixamorigLeftHand0'),
        rArm: find('mixamorigRightArm'), rFore: find('mixamorigRightForeArm'), rHand: find('mixamorigRightHand0'),
      };
      this.rest = new Map();
      for (const b of Object.values(this.bones)) if (b) this.rest.set(b, b.quaternion.clone());
      this.hipsRestY = this.bones.hips?.position.y ?? 0;
    }

    // Aim frame at chest height in root space (forward = -Z): the weapon lives here.
    this.aim = new THREE.Group();
    this.aim.position.set(0, 1.42, 0);
    this.root.add(this.aim);
    this.head = new THREE.Object3D();
    this.head.position.set(0, 1.62, 0);
    this.root.add(this.head);

    this.walkPhase = Math.random() * 6;
    this.dead = false;
    this.deathT = 0;
    this.deathSide = 1;
    this.gun = null;
    this.weaponId = null;
    this.pack = new THREE.Group(); // C4 on the back
    const c4 = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.08), new THREE.MeshStandardMaterial({ color: 0x5b5a3e, roughness: 0.8 }));
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.015, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false }));
    led.position.set(0.06, 0.04, 0.045);
    this.pack.add(c4, led);
    this.packLed = led;
    this.pack.position.set(0, 1.25, 0.2);
    this.pack.visible = false;
    this.root.add(this.pack);
  }

  setWeapon(id) {
    if (id === this.weaponId) return;
    this.weaponId = id;
    if (this.gun) this.aim.remove(this.gun);
    this.gun = buildWeaponMesh(id || 'p9');
    const small = SMALL_ITEMS.has(id);
    // Rifles are shouldered on the right; pistols and items are held out in front.
    this.gun.position.set(small ? 0.06 : 0.16, small ? 0.02 : -0.05, small ? -0.42 : -0.2);
    this.gun.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.aim.add(this.gun);
    this.small = small;
  }

  muzzleWorld(out = new THREE.Vector3()) {
    if (this.gun?.userData.muzzle) return this.gun.localToWorld(out.copy(this.gun.userData.muzzle));
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
    if (this.gun) this.gun.visible = true;
  }

  /** Reset to rest, then layer: legs (walk / crouch / air) → spine (aim) → arms (IK to the gun). */
  update(dt, s) {
    const B = this.bones;
    const crouch = s.crouch || 0;
    const speed = s.speed || 0;
    const pitch = s.pitch || 0;

    if (this.dead) {
      this.deathT = Math.min(1, this.deathT + dt / 0.6);
      const e = 1 - Math.pow(1 - this.deathT, 3);
      this.pose.rotation.x = e * Math.PI / 2 * 0.98;
      this.pose.rotation.z = this.deathSide * e * 0.25;
      this.pose.position.y = 0.12 * e;
      this.pose.position.z = 0.25 * e;
      this.blob.visible = false;
      if (this.gun) this.gun.visible = this.deathT < 0.3;
      return;
    }
    // aim frame follows crouch and pitch
    this.aim.position.y = 1.42 - crouch * 0.5;
    this.head.position.y = 1.62 - crouch * 0.52;
    this.aim.rotation.x = pitch;
    this.aim.rotation.z = s.reloading ? -0.35 : 0;
    if (s.using) this.aim.rotation.x = -0.8;
    this.pack.visible = !!s.bomb;
    this.pack.position.y = 1.25 - crouch * 0.45;
    this.packLed.visible = Math.sin(performance.now() / 120) > 0;
    if (!this.ok) return;

    for (const [b, q] of this.rest) b.quaternion.copy(q);
    if (B.hips) B.hips.position.y = this.hipsRestY;

    const k = Math.min(1, speed / 5);
    this.walkPhase += dt * (2.2 + speed * 1.55) * (speed > 0.2 ? 1 : 0);
    const swing = Math.sin(this.walkPhase) * 0.62 * k;
    const lift = (ph) => Math.max(0, Math.sin(ph)) * 0.9 * k;
    const X = new THREE.Vector3(1, 0, 0);
    const rotX = (bone, ang) => { if (bone) bone.quaternion.multiply(q1.setFromAxisAngle(X, ang)); };

    // Crouch: drop the hips, fold hips/knees/ankles.
    if (B.hips) B.hips.position.y = this.hipsRestY * (1 - crouch * 0.33) - Math.abs(Math.cos(this.walkPhase)) * this.hipsRestY * 0.02 * k;
    const air = !s.onGround;
    for (const [up, leg, foot, side] of [[B.lUpLeg, B.lLeg, B.lFoot, 1], [B.rUpLeg, B.rLeg, B.rFoot, -1]]) {
      const ph = this.walkPhase + (side > 0 ? 0 : Math.PI);
      let thigh = -crouch * 1.25 + Math.sin(ph) * 0.62 * k * (1 - crouch * 0.4);
      let knee = crouch * 2.1 + lift(ph + 0.6);
      if (air) { thigh = -0.7; knee = 1.2; }
      rotX(up, thigh);
      rotX(leg, knee);
      rotX(foot, -crouch * 0.85 + (air ? 0.3 : 0));
    }
    void swing;
    // Spine carries the aim pitch and leans into a crouch.
    const lean = crouch * 0.35;
    rotX(B.spine, (-pitch * 0.25) + lean);
    rotX(B.spine1, -pitch * 0.25);
    rotX(B.spine2, -pitch * 0.25 + Math.sin(this.walkPhase * 2) * 0.03 * k);
    rotX(B.neck, -pitch * 0.2);

    // Hands onto the weapon.
    this.root.updateMatrixWorld(true);
    if (this.gun && B.rArm && B.lArm) {
      const grip = this.gun.localToWorld(new THREE.Vector3(0, -0.02, 0.03));
      const fore = this.small
        ? this.gun.localToWorld(new THREE.Vector3(-0.03, -0.04, 0.06))
        : this.gun.localToWorld(this.gun.userData.fore?.clone() || new THREE.Vector3(0, 0, -0.3));
      const right = this.root.localToWorld(new THREE.Vector3(0.6, 0.6 - crouch * 0.4, 0.4));
      const left = this.root.localToWorld(new THREE.Vector3(-0.6, 0.4 - crouch * 0.4, 0.2));
      solveArm(B.rArm, B.rFore, B.rHand, grip, right);
      solveArm(B.lArm, B.lFore, B.lHand, fore, left);
    }
  }
}
