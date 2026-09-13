// Particles, milk tracers, decals, smoke clouds, fondue fires, slick puddles and explosions.
import * as THREE from 'three';
import { spriteTexture, smokePuffTexture, splatTexture } from './textures.js';
import { UTIL } from '/shared/constants.js';

const VERT = `
attribute float size; attribute float alpha; attribute vec3 pcolor; attribute float rot;
uniform float uScale; varying float vAlpha; varying vec3 vColor; varying float vRot;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * uScale / max(0.05, -mv.z);
  gl_Position = projectionMatrix * mv;
  vAlpha = alpha; vColor = pcolor; vRot = rot;
}`;
const FRAG = `
uniform sampler2D map; varying float vAlpha; varying vec3 vColor; varying float vRot;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float s = sin(vRot), co = cos(vRot);
  vec2 uv = vec2(c.x * co - c.y * s, c.x * s + c.y * co) + 0.5;
  vec4 t = texture2D(map, uv);
  float a = t.a * vAlpha;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * t.rgb, a);
}`;

class Particles {
  constructor(scene, max, map, blending) {
    this.max = max;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.alpha = new Float32Array(max);
    this.size = new Float32Array(max);
    this.rot = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('pcolor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('rot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo = g;
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: map }, uScale: { value: 500 } },
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, blending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.curve = new Uint8Array(max);
    this.spin = new Float32Array(max);
    this.cursor = 0;
    this.active = 0;
  }

  emit(p, v, { life = 1, size = 0.2, size1 = size, alpha = 1, color = 0xffffff, gravity = 0, drag = 0, curve = 0, spin = 0 } = {}) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    const i3 = i * 3;
    this.pos[i3] = p[0]; this.pos[i3 + 1] = p[1]; this.pos[i3 + 2] = p[2];
    this.vel[i3] = v[0]; this.vel[i3 + 1] = v[1]; this.vel[i3 + 2] = v[2];
    const c = typeof color === 'number' ? new THREE.Color(color) : color;
    this.col[i3] = c.r; this.col[i3 + 1] = c.g; this.col[i3 + 2] = c.b;
    this.life[i] = life; this.maxLife[i] = life;
    this.s0[i] = size; this.s1[i] = size1; this.a0[i] = alpha;
    this.grav[i] = gravity; this.drag[i] = drag; this.curve[i] = curve;
    this.rot[i] = Math.random() * 6.28; this.spin[i] = spin;
    return i;
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; this.size[i] = 0; continue; }
      this.life[i] -= dt;
      const t = 1 - Math.max(0, this.life[i]) / this.maxLife[i];
      const i3 = i * 3;
      this.vel[i3 + 1] -= this.grav[i] * dt;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      this.vel[i3] *= d; this.vel[i3 + 1] *= d; this.vel[i3 + 2] *= d;
      this.pos[i3] += this.vel[i3] * dt;
      this.pos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pos[i3 + 2] += this.vel[i3 + 2] * dt;
      if (this.grav[i] > 0 && this.pos[i3 + 1] < 0.03) {
        this.pos[i3 + 1] = 0.03;
        this.vel[i3] *= 0.3; this.vel[i3 + 1] = 0; this.vel[i3 + 2] *= 0.3;
      }
      this.rot[i] += this.spin[i] * dt;
      if (this.curve[i] === 1) {
        // plateau (smoke): grow fast, hold, fade out at the end
        this.size[i] = this.s1[i] + (this.s0[i] - this.s1[i]) * Math.exp(-(t * this.maxLife[i]) * 2.2);
        const fadeIn = Math.min(1, t * this.maxLife[i] * 4);
        const fadeOut = Math.min(1, (this.maxLife[i] - t * this.maxLife[i]) / 2.5);
        this.alpha[i] = this.a0[i] * fadeIn * fadeOut;
      } else {
        this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
        this.alpha[i] = this.a0[i] * Math.min(1, t * 12) * (1 - t);
      }
    }
    for (const name of ['position', 'pcolor', 'alpha', 'size', 'rot']) this.geo.attributes[name].needsUpdate = true;
  }

  clear() { this.life.fill(0); }
}

const rand = (a, b) => a + Math.random() * (b - a);
const v3 = (a) => (Array.isArray(a) ? a : [a.x, a.y, a.z]);

export class Effects {
  constructor(scene) {
    this.scene = scene;
    this.time = 0;
    const sprite = spriteTexture();
    this.normal = new Particles(scene, 2500, sprite, THREE.NormalBlending);
    this.additive = new Particles(scene, 1500, sprite, THREE.AdditiveBlending);
    this.smokeSys = new Particles(scene, 600, smokePuffTexture(), THREE.NormalBlending);
    this.smokeSys.points.renderOrder = 5;

    // light pool (fixed count avoids shader recompiles)
    this.lights = [];
    for (let i = 0; i < 3; i++) {
      const l = new THREE.PointLight(0xffaa55, 0, 14, 1.6);
      l.userData.until = 0;
      l.userData.peak = 0;
      l.userData.persist = false;
      scene.add(l);
      this.lights.push(l);
    }

    // tracers
    const tracerGeo = new THREE.CylinderGeometry(0.014, 0.014, 1, 5, 1, true);
    tracerGeo.rotateX(Math.PI / 2);
    this.tracers = [];
    for (let i = 0; i < 80; i++) {
      const m = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({ color: 0xfffdf2, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.visible = false;
      m.frustumCulled = false;
      scene.add(m);
      this.tracers.push({ mesh: m, active: false });
    }
    this.tracerCursor = 0;

    // decals
    this.decalGeo = new THREE.PlaneGeometry(1, 1);
    this.decalTex = { milk: splatTexture('250,250,245'), pink: splatTexture('240,140,170'), scorch: splatTexture('25,20,15') };
    this.decals = [];
    for (let i = 0; i < 160; i++) {
      const mat = new THREE.MeshStandardMaterial({ map: this.decalTex.milk, transparent: true, depthWrite: false, roughness: 0.3, polygonOffset: true, polygonOffsetFactor: -4 });
      const m = new THREE.Mesh(this.decalGeo, mat);
      m.visible = false;
      scene.add(m);
      this.decals.push({ mesh: m, born: -99, life: 0 });
    }
    this.decalCursor = 0;

    this.smokes = new Map();
    this.fires = new Map();
    this.puddles = [];
    this.rings = [];

    const fc = document.createElement('canvas');
    fc.width = fc.height = 128;
    const ctx = fc.getContext('2d');
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
    g.addColorStop(0, 'rgba(255,210,80,0.95)');
    g.addColorStop(0.6, 'rgba(240,160,40,0.8)');
    g.addColorStop(1, 'rgba(200,100,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 30; i++) {
      ctx.fillStyle = `rgba(255,240,150,${Math.random() * 0.6})`;
      ctx.beginPath(); ctx.arc(20 + Math.random() * 88, 20 + Math.random() * 88, 3 + Math.random() * 8, 0, 7); ctx.fill();
    }
    this.fondueTex = new THREE.CanvasTexture(fc);
    this.fondueTex.colorSpace = THREE.SRGBColorSpace;
  }

  setViewport(heightPx, fovDeg) {
    const s = heightPx / (2 * Math.tan((fovDeg * Math.PI) / 360));
    for (const p of [this.normal, this.additive, this.smokeSys]) p.mat.uniforms.uScale.value = s;
  }

  flashLight(pos, color, intensity, duration, distance = 14) {
    const l = this.lights.reduce((a, b) => (a.userData.until < b.userData.until ? a : b));
    l.position.set(...v3(pos));
    l.color.setHex(color);
    l.distance = distance;
    l.userData.peak = intensity;
    l.userData.born = this.time;
    l.userData.until = this.time + duration;
    l.intensity = intensity;
  }

  tracer(from, to) {
    const t = this.tracers[this.tracerCursor];
    this.tracerCursor = (this.tracerCursor + 1) % this.tracers.length;
    const a = new THREE.Vector3(...v3(from));
    const b = new THREE.Vector3(...v3(to));
    t.a = a; t.b = b;
    t.dir = new THREE.Vector3().subVectors(b, a);
    t.total = t.dir.length();
    if (t.total < 0.5) return;
    t.dir.divideScalar(t.total);
    t.head = 0;
    t.len = Math.min(5, t.total);
    t.speed = 320;
    t.active = true;
    t.mesh.visible = true;
  }

  muzzle(pos, dir, strength = 1) {
    const p = v3(pos);
    this.additive.emit(p, [0, 0, 0], { life: 0.06, size: 0.5 * strength, size1: 0.8 * strength, alpha: 0.9, color: 0xfff4d0 });
    const d = v3(dir || [0, 0, 0]);
    for (let i = 0; i < 4; i++) {
      this.normal.emit(p, [d[0] * rand(4, 9) + rand(-1, 1), d[1] * rand(4, 9) + rand(-0.5, 1.5), d[2] * rand(4, 9) + rand(-1, 1)], { life: rand(0.25, 0.5), size: 0.05, size1: 0.02, color: 0xffffff, gravity: 9, alpha: 0.9 });
    }
  }

  impact(pos, normal, colorHex = 0x999999) {
    const p = v3(pos), n = v3(normal);
    for (let i = 0; i < 9; i++) {
      this.normal.emit(p, [n[0] * rand(1, 4) + rand(-2, 2), n[1] * rand(1, 4) + rand(0, 3), n[2] * rand(1, 4) + rand(-2, 2)], { life: rand(0.3, 0.7), size: rand(0.03, 0.07), size1: 0.02, color: 0xfdfdf8, gravity: 12 });
    }
    for (let i = 0; i < 3; i++) {
      this.normal.emit([p[0] + n[0] * 0.05, p[1] + n[1] * 0.05, p[2] + n[2] * 0.05], [n[0] * rand(0.3, 1) + rand(-0.3, 0.3), rand(0.2, 0.8), n[2] * rand(0.3, 1) + rand(-0.3, 0.3)], { life: rand(0.5, 1), size: 0.2, size1: 0.7, color: colorHex, alpha: 0.45, drag: 2 });
    }
    this.decal(p, n, 'milk', rand(0.18, 0.3));
  }

  decal(pos, normal, type = 'milk', size = 0.25, life = 14) {
    const d = this.decals[this.decalCursor];
    this.decalCursor = (this.decalCursor + 1) % this.decals.length;
    const p = v3(pos), n = new THREE.Vector3(...v3(normal));
    d.mesh.material.map = this.decalTex[type];
    d.mesh.material.needsUpdate = true;
    d.mesh.position.set(p[0] + n.x * 0.012, p[1] + n.y * 0.012, p[2] + n.z * 0.012);
    d.mesh.lookAt(d.mesh.position.clone().add(n));
    d.mesh.rotateZ(Math.random() * 6.28);
    d.mesh.scale.setScalar(size);
    d.mesh.visible = true;
    d.mesh.material.opacity = 1;
    d.born = this.time;
    d.life = life;
  }

  bloodSplat(pos, dir) {
    const p = v3(pos), d = v3(dir);
    for (let i = 0; i < 14; i++) {
      this.normal.emit(p, [d[0] * rand(1, 5) + rand(-2, 2), rand(-0.5, 3), d[2] * rand(1, 5) + rand(-2, 2)], { life: rand(0.4, 0.8), size: rand(0.05, 0.1), size1: 0.03, color: 0xf07fa5, gravity: 11 });
    }
    this.normal.emit(p, [0, 0.3, 0], { life: 0.35, size: 0.3, size1: 0.6, color: 0xf6a5c0, alpha: 0.7, drag: 3 });
  }

  explosion(pos) {
    const p = v3(pos);
    this.additive.emit([p[0], p[1] + 0.3, p[2]], [0, 0, 0], { life: 0.25, size: 4, size1: 8, color: 0xffd27a, alpha: 1 });
    for (let i = 0; i < 26; i++) {
      this.additive.emit(p, [rand(-8, 8), rand(2, 10), rand(-8, 8)], { life: rand(0.2, 0.5), size: 0.6, size1: 0.1, color: 0xffa640, drag: 3 });
    }
    for (let i = 0; i < 40; i++) {
      this.normal.emit(p, [rand(-9, 9), rand(3, 12), rand(-9, 9)], { life: rand(0.8, 1.5), size: rand(0.08, 0.16), size1: 0.06, color: 0xf2c84a, gravity: 18, spin: rand(-8, 8) });
    }
    for (let i = 0; i < 16; i++) {
      this.normal.emit([p[0] + rand(-1, 1), p[1] + rand(0, 1), p[2] + rand(-1, 1)], [rand(-2, 2), rand(0.5, 2.5), rand(-2, 2)], { life: rand(1.5, 2.8), size: 1.5, size1: 4.5, color: 0x6d655a, alpha: 0.55, drag: 1.2 });
    }
    this.flashLight(p, 0xffb050, 60, 0.35, 18);
    this.decal([p[0], 0.01, p[2]], [0, 1, 0], 'scorch', 3.5, 20);
    this.ring(p, 0xfff0c0, 7, 0.35);
  }

  flashBurst(pos) {
    const p = v3(pos);
    this.additive.emit(p, [0, 0, 0], { life: 0.2, size: 6, size1: 12, color: 0xfff6b0, alpha: 1 });
    for (let i = 0; i < 30; i++) {
      this.normal.emit(p, [rand(-7, 7), rand(-2, 7), rand(-7, 7)], { life: rand(0.5, 1.1), size: rand(0.06, 0.14), size1: 0.05, color: 0xffd84a, gravity: 14 });
    }
    this.flashLight(p, 0xfff3b0, 80, 0.2, 25);
  }

  smoke(id, pos, duration = UTIL.SMOKE_DURATION) {
    const p = v3(pos);
    const R = UTIL.SMOKE_RADIUS;
    const entry = { id, x: p[0], y: p[1], z: p[2], born: this.time, until: this.time + duration, idx: [] };
    const colors = [0x9fb48c, 0x8ea37d, 0xb0c29c, 0x7f9170];
    const count = 44;
    for (let i = 0; i < count; i++) {
      const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2;
      const r = Math.cbrt(Math.random()) * R * 0.85;
      const s = Math.sqrt(1 - u * u);
      const off = [Math.cos(th) * s * r, Math.abs(u) * r * 0.6 + 0.4, Math.sin(th) * s * r];
      this.smokeSys.emit([p[0] + off[0] * 0.15, p[1] + 0.3, p[2] + off[2] * 0.15], [off[0] * 2.6, off[1] * 2.6, off[2] * 2.6], {
        life: duration + rand(-1.5, 0.5), size: 1.2, size1: rand(4.8, 6.8), alpha: 0.9, color: colors[i % colors.length], drag: 2.8, curve: 1, spin: rand(-0.15, 0.15),
      });
    }
    this.smokes.set(id, entry);
    for (let i = 0; i < 24; i++) {
      this.normal.emit([p[0], p[1] + 0.2, p[2]], [rand(-6, 6), rand(0, 4), rand(-6, 6)], { life: 0.8, size: 0.8, size1: 2, color: 0xc8d8b0, alpha: 0.5, drag: 3 });
    }
  }

  fire(id, pos, duration = UTIL.FIRE_DURATION) {
    const p = v3(pos);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(UTIL.FIRE_RADIUS, 32), new THREE.MeshBasicMaterial({ map: this.fondueTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.set(p[0], p[1] + 0.03, p[2]);
    disc.scale.setScalar(0.1);
    this.scene.add(disc);
    this.fires.set(id, { id, x: p[0], y: p[1], z: p[2], born: this.time, until: this.time + duration, disc, acc: 0 });
    this.flashLight([p[0], p[1] + 1, p[2]], 0xff9a30, 25, 0.4, 16);
  }

  removeFire(id) {
    const f = this.fires.get(id);
    if (!f) return;
    this.scene.remove(f.disc);
    f.disc.geometry.dispose();
    this.fires.delete(id);
    for (let i = 0; i < 20; i++) this.normal.emit([f.x + rand(-2, 2), f.y + 0.3, f.z + rand(-2, 2)], [rand(-0.5, 0.5), rand(1, 2), rand(-0.5, 0.5)], { life: 1.5, size: 1, size1: 2.5, color: 0x555555, alpha: 0.4, drag: 1 });
  }

  fizzle(pos) {
    const p = v3(pos);
    for (let i = 0; i < 20; i++) this.normal.emit(p, [rand(-2, 2), rand(1, 3), rand(-2, 2)], { life: 1, size: 0.5, size1: 1.5, color: 0xaaaaaa, alpha: 0.5, drag: 2 });
  }

  puddle(pos, duration = UTIL.PUDDLE_DURATION) {
    const p = v3(pos);
    const m = new THREE.Mesh(new THREE.CircleGeometry(1, 24), new THREE.MeshStandardMaterial({ color: 0xfbfbf6, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(p[0], p[1] + 0.02, p[2]);
    m.scale.setScalar(0.01);
    this.scene.add(m);
    this.puddles.push({ x: p[0], y: p[1], z: p[2], born: this.time, until: this.time + duration, mesh: m });
  }

  ring(pos, color, radius, dur) {
    const p = v3(pos);
    const m = new THREE.Mesh(new THREE.RingGeometry(0.8, 1, 40), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(p[0], Math.max(0.05, p[1]), p[2]);
    this.scene.add(m);
    this.rings.push({ mesh: m, born: this.time, dur, radius });
  }

  bombExplosion(pos) {
    const p = v3(pos);
    for (let i = 0; i < 3; i++) this.explosion([p[0] + rand(-2, 2), p[1] + rand(0, 2), p[2] + rand(-2, 2)]);
    for (let i = 0; i < 120; i++) {
      this.normal.emit([p[0], p[1] + 1, p[2]], [rand(-18, 18), rand(4, 26), rand(-18, 18)], { life: rand(1, 2.2), size: rand(0.15, 0.35), size1: 0.1, color: 0xf6f3d8, gravity: 16 });
    }
    for (let i = 0; i < 40; i++) {
      this.normal.emit([p[0] + rand(-3, 3), p[1] + rand(0, 6), p[2] + rand(-3, 3)], [rand(-3, 3), rand(3, 9), rand(-3, 3)], { life: rand(2.5, 4.5), size: 3, size1: 10, color: 0x9daa8a, alpha: 0.6, drag: 0.8 });
    }
    this.ring(p, 0xe8ffd0, 26, 0.9);
    this.flashLight([p[0], p[1] + 3, p[2]], 0xffe0a0, 200, 1.0, 60);
  }

  onPuddle(x, y, z) {
    return this.puddles.some((pd) => Math.hypot(pd.x - x, pd.z - z) < UTIL.PUDDLE_RADIUS && Math.abs(pd.y - y) < 0.6);
  }

  inFire(x, y, z) {
    for (const f of this.fires.values()) if (Math.hypot(f.x - x, f.z - z) < UTIL.FIRE_RADIUS && Math.abs(f.y - y) < 1.2) return true;
    return false;
  }

  smokeDensity(pos) {
    let d = 0;
    for (const s of this.smokes.values()) {
      const age = this.time - s.born;
      const grow = Math.min(1, age / 1.4);
      const fade = Math.min(1, (s.until - this.time) / 2.5);
      const dist = Math.hypot(pos.x - s.x, (pos.y - (s.y + 1.4)) * 1.4, pos.z - s.z);
      const R = UTIL.SMOKE_RADIUS * grow;
      if (dist < R) d = Math.max(d, Math.min(1, (1 - dist / R) * 2.2) * fade);
    }
    return d;
  }

  clear() {
    this.normal.clear();
    this.additive.clear();
    this.smokeSys.clear();
    this.smokes.clear();
    for (const id of [...this.fires.keys()]) {
      const f = this.fires.get(id);
      this.scene.remove(f.disc);
    }
    this.fires.clear();
    for (const p of this.puddles) this.scene.remove(p.mesh);
    this.puddles = [];
    for (const d of this.decals) d.mesh.visible = false;
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    this.normal.update(dt);
    this.additive.update(dt);
    this.smokeSys.update(dt);

    for (const l of this.lights) {
      if (t >= l.userData.until) { l.intensity = 0; continue; }
      const k = 1 - (t - l.userData.born) / (l.userData.until - l.userData.born);
      l.intensity = l.userData.peak * k * k;
    }

    for (const tr of this.tracers) {
      if (!tr.active) continue;
      tr.head += tr.speed * dt;
      const tail = tr.head - tr.len;
      if (tail >= tr.total) { tr.active = false; tr.mesh.visible = false; continue; }
      const h = Math.min(tr.head, tr.total), tl = Math.max(0, tail);
      const len = Math.max(0.01, h - tl);
      const mid = tr.a.clone().addScaledVector(tr.dir, (h + tl) / 2);
      tr.mesh.position.copy(mid);
      tr.mesh.lookAt(mid.clone().add(tr.dir));
      tr.mesh.scale.set(1, 1, len);
    }

    for (const d of this.decals) {
      if (!d.mesh.visible) continue;
      const age = t - d.born;
      if (age > d.life) d.mesh.visible = false;
      else if (age > d.life - 2) d.mesh.material.opacity = (d.life - age) / 2;
    }

    for (const [id, s] of this.smokes) if (t > s.until) this.smokes.delete(id);

    for (const [id, f] of this.fires) {
      if (t > f.until) { this.removeFire(id); continue; }
      const age = t - f.born;
      const grow = Math.min(1, age / 0.5);
      const left = f.until - t;
      f.disc.scale.setScalar(Math.max(0.01, grow * Math.min(1, left / 0.8)));
      f.acc += dt * 70 * grow;
      while (f.acc > 1) {
        f.acc -= 1;
        const a = Math.random() * 6.28, r = Math.sqrt(Math.random()) * UTIL.FIRE_RADIUS * 0.9 * grow;
        const px = f.x + Math.cos(a) * r, pz = f.z + Math.sin(a) * r;
        this.additive.emit([px, f.y + 0.1, pz], [rand(-0.3, 0.3), rand(1.5, 3.5), rand(-0.3, 0.3)], { life: rand(0.35, 0.8), size: rand(0.5, 1.0), size1: 0.1, color: Math.random() < 0.5 ? 0xff8a1e : 0xffc53a, alpha: 0.85 });
        if (Math.random() < 0.15) this.normal.emit([px, f.y + 0.05, pz], [0, rand(0.5, 1.5), 0], { life: 0.5, size: 0.12, size1: 0.2, color: 0xffe08a, gravity: 2 });
        if (Math.random() < 0.05) this.normal.emit([px, f.y + 1.2, pz], [rand(-0.3, 0.3), rand(0.8, 1.6), rand(-0.3, 0.3)], { life: 2, size: 0.8, size1: 2.2, color: 0x4a4038, alpha: 0.35, drag: 0.5 });
      }
      const lt = this.lights.find((l) => l.userData.fire === id);
      if (Math.random() < 0.08) this.flashLight([f.x, f.y + 1, f.z], 0xff8a2a, rand(10, 18), 0.25, 12);
    }

    this.puddles = this.puddles.filter((p) => {
      if (t > p.until) { this.scene.remove(p.mesh); return false; }
      const age = t - p.born;
      const k = Math.min(1, age / 0.25) * Math.min(1, (p.until - t) / 1.5);
      p.mesh.scale.setScalar(Math.max(0.01, UTIL.PUDDLE_RADIUS * (0.6 + 0.4 * Math.min(1, age / 0.25))));
      p.mesh.material.opacity = 0.9 * k;
      return true;
    });

    this.rings = this.rings.filter((r) => {
      const k = (t - r.born) / r.dur;
      if (k >= 1) { this.scene.remove(r.mesh); return false; }
      r.mesh.scale.setScalar(0.5 + r.radius * k);
      r.mesh.material.opacity = 0.6 * (1 - k);
      return true;
    });
  }
}
