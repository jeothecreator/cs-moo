// Detailed weapon models (extruded profiles, bevels, optics) + first-person viewmodel with aim-down-sights.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

let M = null;

function canvasTex(size, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(...repeat);
  return t;
}

function mats() {
  if (M) return M;
  const grain = canvasTex(256, (ctx, s) => {
    ctx.fillStyle = '#7a4524';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 140; i++) {
      ctx.strokeStyle = `rgba(${40 + Math.random() * 40},${20 + Math.random() * 15},8,${0.15 + Math.random() * 0.3})`;
      ctx.lineWidth = 1 + Math.random() * 2;
      ctx.beginPath();
      const y = Math.random() * s;
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(s * 0.3, y + Math.random() * 10 - 5, s * 0.6, y + Math.random() * 10 - 5, s, y);
      ctx.stroke();
    }
  }, [3, 3]);
  const knurl = canvasTex(128, (ctx, s) => {
    ctx.fillStyle = '#1b1c1f';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#2c2e33';
    for (let y = 0; y < s; y += 8) for (let x = (y / 8) % 2 ? 4 : 0; x < s; x += 8) ctx.fillRect(x, y, 4, 4);
  }, [6, 6]);
  const spots = canvasTex(128, (ctx, s) => {
    ctx.fillStyle = '#f1ede4';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#18181a';
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      const x = Math.random() * s, y = Math.random() * s;
      for (let a = 0; a < 6.3; a += 0.6) ctx.lineTo(x + Math.cos(a) * (10 + Math.random() * 14), y + Math.sin(a) * (10 + Math.random() * 14));
      ctx.fill();
    }
  }, [2, 2]);
  const std = (o) => new THREE.MeshStandardMaterial(o);
  M = {
    gunmetal: std({ color: 0x2c3036, roughness: 0.36, metalness: 0.85 }),
    polymer: std({ color: 0x1e2024, roughness: 0.72, metalness: 0.08 }),
    grip: std({ map: knurl, roughness: 0.85, metalness: 0.05 }),
    tan: std({ color: 0xb49a72, roughness: 0.62, metalness: 0.05 }),
    olive: std({ color: 0x59603f, roughness: 0.6, metalness: 0.1 }),
    wood: std({ map: grain, roughness: 0.5, metalness: 0 }),
    steel: std({ color: 0xa9b1b8, roughness: 0.22, metalness: 1 }),
    chrome: std({ color: 0xe4e8ec, roughness: 0.1, metalness: 1 }),
    ceramic: std({ color: 0xf4f1ea, roughness: 0.3, metalness: 0 }),
    milk: std({ color: 0xffffff, roughness: 0.12, metalness: 0, transparent: true, opacity: 0.92, emissive: 0x2a2a2a }),
    pink: std({ color: 0xf19ab4, roughness: 0.42, metalness: 0.05 }),
    spots: std({ map: spots, roughness: 0.55 }),
    blue: std({ color: 0x2f6fd0, roughness: 0.4, metalness: 0.2 }),
    red: std({ color: 0xb3261e, roughness: 0.45 }),
    brass: std({ color: 0xc9a13b, roughness: 0.3, metalness: 1 }),
    butter: std({ color: 0xf6d768, roughness: 0.55 }),
    cheese: std({ color: 0xf2b632, roughness: 0.5 }),
    wax: std({ color: 0xbf2626, roughness: 0.35, metalness: 0.05 }),
    carton: std({ color: 0x6fae5c, roughness: 0.7 }),
    paper: std({ color: 0xf5f1e6, roughness: 0.8 }),
    amber: std({ color: 0x8a4a12, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.82 }),
    lens: std({ color: 0x4aa3ff, roughness: 0.02, metalness: 1, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false }),
    scopeLens: std({ color: 0x0c1a2a, roughness: 0.05, metalness: 1 }),
    dot: new THREE.MeshBasicMaterial({ color: 0xff2a2a, toneMapped: false }),
    led: new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false }),
    glove: std({ color: 0x1f2124, roughness: 0.8 }),
    gloveKnuckle: std({ color: 0x2e3136, roughness: 0.6 }),
  };
  return M;
}

function roundedRect(w, h, r) {
  const s = new THREE.Shape();
  const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r); s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** Builder working in side-view coordinates: u = forward along barrel (→ -Z), v = up (+Y). */
class Gun {
  constructor() {
    this.g = new THREE.Group();
    this.m = mats();
    this.g.userData.muzzle = new THREE.Vector3(0, 0.05, -0.5);
    this.g.userData.fore = new THREE.Vector3(0, 0, -0.3);
    this.g.userData.sight = null;
  }

  put(mesh, u = 0, v = 0, x = 0, parent = this.g) {
    mesh.position.set(x, v, -u);
    parent.add(mesh);
    return mesh;
  }

  box(len, h, w, mat, u, v, { x = 0, r = 0.004, parent } = {}) {
    const rr = Math.max(0.0005, Math.min(r, len / 2.05, h / 2.05, w / 2.05));
    return this.put(new THREE.Mesh(new RoundedBoxGeometry(w, h, len, 2, rr), mat), u, v, x, parent);
  }

  ext(pts, width, mat, { bevel = 0.003, x = 0, parent } = {}) {
    const shape = new THREE.Shape(pts.map(([u, v]) => new THREE.Vector2(u, v)));
    const depth = Math.max(0.001, width - bevel * 2);
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 2, curveSegments: 8 });
    geo.translate(0, 0, -depth / 2);
    geo.rotateY(Math.PI / 2);
    geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.x = x;
    (parent || this.g).add(mesh);
    return mesh;
  }

  tube(r, len, mat, u, v, { r2 = r, seg = 20, x = 0, parent } = {}) {
    const geo = new THREE.CylinderGeometry(r, r2, len, seg);
    geo.rotateX(-Math.PI / 2);
    return this.put(new THREE.Mesh(geo, mat), u, v, x, parent);
  }

  lathe(profile, mat, u, v, { seg = 24, x = 0, parent, alongBarrel = false } = {}) {
    const geo = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), seg);
    if (alongBarrel) geo.rotateX(-Math.PI / 2);
    return this.put(new THREE.Mesh(geo, mat), u, v, x, parent);
  }

  rail(u0, u1, v, width = 0.024) {
    const len = u1 - u0;
    this.box(len, 0.008, width, this.m.gunmetal, (u0 + u1) / 2, v, { r: 0.001 });
    const n = Math.floor(len / 0.012);
    for (let i = 0; i < n; i++) this.box(0.006, 0.006, width + 0.004, this.m.gunmetal, u0 + 0.006 + i * 0.012, v + 0.006, { r: 0.001 });
  }

  redDot(u, v) {
    const m = this.m;
    const w = 0.05, h = 0.046, depth = 0.034, hole = 0.0175;
    const shape = roundedRect(w, h, 0.012);
    const holePath = new THREE.Path();
    holePath.absarc(0, 0.002, hole, 0, Math.PI * 2, true);
    shape.holes.push(holePath);
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.002, bevelSize: 0.002, bevelSegments: 2, curveSegments: 20 });
    geo.translate(0, 0, -depth / 2);
    this.put(new THREE.Mesh(geo, m.polymer), u, v);
    this.box(0.05, 0.016, 0.03, m.gunmetal, u, v - h / 2 - 0.006);
    this.box(0.012, 0.01, 0.012, m.gunmetal, u + 0.005, v, { x: 0.03, r: 0.002 });
    const lens = this.put(new THREE.Mesh(new THREE.CircleGeometry(hole, 24), m.lens), u + depth / 2 - 0.004, v + 0.002);
    lens.rotation.y = 0;
    this.put(new THREE.Mesh(new THREE.SphereGeometry(0.0011, 8, 6), m.dot), u + depth / 2 - 0.006, v + 0.002);
    this.g.userData.sight = new THREE.Vector3(0, v + 0.002, -u);
  }

  holo(u, v) {
    const m = this.m;
    const w = 0.052, h = 0.044, depth = 0.05;
    const shape = roundedRect(w, h, 0.006);
    const hp = new THREE.Path();
    const iw = 0.042, ih = 0.03;
    hp.moveTo(-iw / 2, -ih / 2 + 0.004); hp.lineTo(-iw / 2, ih / 2 + 0.004); hp.lineTo(iw / 2, ih / 2 + 0.004); hp.lineTo(iw / 2, -ih / 2 + 0.004); hp.lineTo(-iw / 2, -ih / 2 + 0.004);
    shape.holes.push(hp);
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: 0.0015, bevelSize: 0.0015, bevelSegments: 1 });
    geo.translate(0, 0, -depth / 2);
    this.put(new THREE.Mesh(geo, m.gunmetal), u, v);
    this.box(0.06, 0.012, 0.034, m.gunmetal, u, v - h / 2 - 0.004);
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(iw, ih), m.lens);
    this.put(glass, u + 0.018, v + 0.004);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.0042, 0.00035, 6, 32), m.dot);
    this.put(ring, u + 0.016, v + 0.004);
    this.put(new THREE.Mesh(new THREE.SphereGeometry(0.0006, 6, 4), m.dot), u + 0.016, v + 0.004);
    this.g.userData.sight = new THREE.Vector3(0, v + 0.004, -u);
  }

  irons(uFront, uRear, v) {
    const m = this.m;
    this.box(0.006, 0.014, 0.004, m.steel, uFront, v + 0.007, { r: 0.001 });
    this.put(new THREE.Mesh(new THREE.SphereGeometry(0.0014, 8, 6), m.ceramic), uFront, v + 0.014);
    for (const x of [-0.0055, 0.0055]) this.box(0.006, 0.012, 0.004, m.gunmetal, uRear, v + 0.006, { x, r: 0.001 });
    this.g.userData.sight = new THREE.Vector3(0, v + 0.0125, -uFront);
  }

  scope(u, v, len = 0.3) {
    const m = this.m;
    this.tube(0.017, len * 0.6, m.polymer, u, v);
    this.lathe([[0.017, 0], [0.028, 0.03], [0.029, 0.09], [0.026, 0.095]], m.polymer, u + len * 0.3, v, { alongBarrel: true });
    this.lathe([[0.017, 0], [0.024, -0.03], [0.024, -0.07], [0.021, -0.075]], m.polymer, u - len * 0.3, v, { alongBarrel: true });
    this.put(new THREE.Mesh(new THREE.CircleGeometry(0.026, 24), m.scopeLens), u + len * 0.3 + 0.094, v).rotation.y = Math.PI;
    this.put(new THREE.Mesh(new THREE.CircleGeometry(0.021, 24), m.scopeLens), u - len * 0.3 - 0.074, v);
    this.box(0.022, 0.022, 0.022, m.polymer, u, v + 0.024, { r: 0.004 });
    this.box(0.022, 0.018, 0.022, m.polymer, u, v, { x: 0.025, r: 0.004 });
    for (const du of [-0.06, 0.06]) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.02, 0.004, 8, 20), m.gunmetal);
      this.put(ring, u + du, v);
      this.box(0.016, 0.03, 0.018, m.gunmetal, u + du, v - 0.03);
    }
    this.g.userData.sight = new THREE.Vector3(0, v, -u);
  }

  done() {
    this.g.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    return this.g;
  }
}

const BUILDERS = {
  ak(b) {
    const m = b.m;
    b.ext([[-0.12, 0.028], [0.2, 0.028], [0.22, 0.05], [0.22, 0.09], [0.19, 0.104], [-0.1, 0.104], [-0.12, 0.09]], 0.05, m.gunmetal);
    b.box(0.29, 0.02, 0.046, m.gunmetal, 0.04, 0.108, { r: 0.008 });
    for (let i = 0; i < 6; i++) b.box(0.004, 0.012, 0.052, m.polymer, 0.13 + i * 0.012, 0.07, { r: 0.001 });
    b.ext([[-0.12, 0.09], [-0.12, 0.032], [-0.42, -0.03], [-0.45, -0.03], [-0.45, 0.07], [-0.3, 0.09]], 0.042, m.wood, { bevel: 0.005 });
    b.box(0.005, 0.1, 0.046, m.polymer, -0.448, 0.02, { r: 0.002 });
    b.ext([[-0.02, 0.03], [0.035, 0.03], [0.012, -0.085], [-0.035, -0.09], [-0.048, -0.078]], 0.034, m.wood, { bevel: 0.004 });
    b.ext([[0.022, 0.03], [0.1, 0.03], [0.1, 0.022], [0.03, -0.012], [0.022, 0.0]], 0.01, m.gunmetal, { bevel: 0.001 });
    b.ext([[0.22, 0.035], [0.44, 0.04], [0.44, 0.098], [0.22, 0.1]], 0.058, m.wood, { bevel: 0.006 });
    b.tube(0.011, 0.22, m.gunmetal, 0.33, 0.118);
    b.tube(0.011, 0.26, m.gunmetal, 0.56, 0.07);
    b.box(0.03, 0.05, 0.022, m.gunmetal, 0.62, 0.09, { r: 0.003 });
    b.box(0.004, 0.018, 0.004, m.steel, 0.625, 0.122, { r: 0.001 });
    b.tube(0.016, 0.06, m.polymer, 0.71, 0.07, { r2: 0.015 });
    const mag = new THREE.Group();
    b.ext([[0.09, 0.03], [0.165, 0.03], [0.21, -0.1], [0.2, -0.2], [0.125, -0.21], [0.12, -0.11]], 0.03, m.ceramic, { bevel: 0.004, parent: mag });
    b.ext([[0.175, -0.05], [0.19, -0.1], [0.12, -0.1], [0.11, -0.05]], 0.034, m.blue, { bevel: 0.001, parent: mag });
    b.g.add(mag);
    b.g.userData.mag = mag;
    b.box(0.07, 0.012, 0.004, m.spots, -0.3, 0.02, { x: 0.023, r: 0.001 });
    b.box(0.07, 0.012, 0.004, m.spots, -0.3, 0.02, { x: -0.023, r: 0.001 });
    b.rail(-0.04, 0.12, 0.122);
    b.redDot(0.04, 0.158);
    b.g.userData.muzzle.set(0, 0.07, -0.75);
    b.g.userData.fore.set(0, 0.03, -0.33);
  },
  mooster(b) {
    const m = b.m;
    b.ext([[-0.1, 0.055], [0.19, 0.055], [0.19, 0.1], [-0.1, 0.1]], 0.046, m.gunmetal);
    b.ext([[-0.1, 0.055], [0.17, 0.055], [0.15, 0.0], [0.05, 0.0], [0.0, 0.02], [-0.1, 0.02]], 0.044, m.tan, { bevel: 0.004 });
    b.rail(-0.1, 0.19, 0.104);
    b.tube(0.015, 0.2, m.polymer, -0.2, 0.075);
    b.ext([[-0.24, 0.1], [-0.2, 0.09], [-0.2, 0.05], [-0.26, -0.02], [-0.38, -0.02], [-0.38, 0.1]], 0.04, m.tan, { bevel: 0.006 });
    b.box(0.012, 0.11, 0.044, m.polymer, -0.382, 0.04, { r: 0.004 });
    b.ext([[-0.015, 0.02], [0.035, 0.02], [0.012, -0.09], [-0.035, -0.095], [-0.045, -0.083]], 0.032, m.grip, { bevel: 0.004 });
    const hg = b.box(0.26, 0.052, 0.052, m.tan, 0.32, 0.075, { r: 0.01 });
    for (let i = 0; i < 5; i++) b.box(0.03, 0.012, 0.056, m.polymer, 0.23 + i * 0.045, 0.075, { r: 0.004 });
    b.rail(0.19, 0.45, 0.104);
    b.tube(0.0085, 0.06, m.gunmetal, 0.48, 0.075);
    b.tube(0.021, 0.26, m.polymer, 0.62, 0.075);
    b.tube(0.022, 0.012, m.gunmetal, 0.495, 0.075);
    b.tube(0.022, 0.01, m.gunmetal, 0.745, 0.075);
    b.box(0.014, 0.03, 0.02, m.polymer, 0.43, 0.125, { r: 0.003 });
    const mag = new THREE.Group();
    b.ext([[0.07, 0.02], [0.135, 0.02], [0.15, -0.15], [0.085, -0.155]], 0.028, m.ceramic, { bevel: 0.003, parent: mag });
    b.ext([[0.14, -0.1], [0.148, -0.14], [0.084, -0.145], [0.079, -0.105]], 0.032, m.blue, { bevel: 0.001, parent: mag });
    b.g.add(mag);
    b.g.userData.mag = mag;
    b.box(0.014, 0.04, 0.012, m.polymer, 0.05, 0.13, { x: 0.012, r: 0.003 });
    b.holo(0.02, 0.137);
    b.g.userData.muzzle.set(0, 0.075, -0.76);
    b.g.userData.fore.set(0, 0.035, -0.32);
  },
  milkyway(b) {
    const m = b.m;
    b.ext([[-0.08, 0.02], [0.17, 0.02], [0.17, 0.1], [-0.05, 0.1], [-0.08, 0.08]], 0.056, m.pink, { bevel: 0.006 });
    b.box(0.2, 0.014, 0.05, m.ceramic, 0.04, 0.105, { r: 0.004 });
    for (let i = 0; i < 4; i++) b.box(0.004, 0.03, 0.06, m.polymer, 0.12 + i * 0.012, 0.06, { r: 0.001 });
    b.tube(0.01, 0.07, m.gunmetal, 0.2, 0.07);
    b.tube(0.015, 0.035, m.polymer, 0.24, 0.07);
    b.ext([[-0.02, 0.02], [0.035, 0.02], [0.03, -0.1], [-0.025, -0.1]], 0.04, m.grip, { bevel: 0.004 });
    const mag = new THREE.Group();
    b.ext([[-0.012, -0.08], [0.028, -0.08], [0.028, -0.24], [-0.012, -0.24]], 0.03, m.ceramic, { bevel: 0.003, parent: mag });
    b.box(0.046, 0.012, 0.036, m.blue, 0.008, -0.235, { parent: mag, r: 0.003 });
    b.g.add(mag);
    b.g.userData.mag = mag;
    for (const x of [-0.024, 0.024]) b.tube(0.004, 0.22, m.steel, -0.17, 0.06, { x });
    b.box(0.012, 0.07, 0.056, m.steel, -0.285, 0.04, { r: 0.004 });
    b.ext([[0.14, 0.02], [0.16, 0.02], [0.16, -0.05], [0.1, -0.06]], 0.012, m.polymer, { bevel: 0.002 });
    b.holo(0.03, 0.137);
    b.g.userData.muzzle.set(0, 0.07, -0.27);
    b.g.userData.fore.set(0, -0.02, -0.14);
  },
  pasteurizer(b) {
    const m = b.m;
    b.ext([[-0.1, 0.02], [0.18, 0.02], [0.18, 0.1], [-0.08, 0.1], [-0.1, 0.085]], 0.05, m.gunmetal);
    b.box(0.004, 0.03, 0.052, m.steel, 0.05, 0.07, { r: 0.001 });
    b.tube(0.0165, 0.55, m.gunmetal, 0.45, 0.083);
    b.tube(0.0145, 0.45, m.gunmetal, 0.4, 0.045);
    b.tube(0.017, 0.012, m.steel, 0.7, 0.045);
    for (const u of [0.3, 0.58]) b.box(0.012, 0.06, 0.028, m.gunmetal, u, 0.064, { r: 0.004 });
    const pump = new THREE.Group();
    b.tube(0.026, 0.16, m.wood, 0.42, 0.045, { parent: pump, seg: 16 });
    for (let i = 0; i < 6; i++) b.tube(0.0275, 0.008, m.polymer, 0.36 + i * 0.024, 0.045, { parent: pump, seg: 16 });
    b.g.add(pump);
    b.g.userData.mag = pump;
    b.ext([[-0.1, 0.095], [-0.1, 0.03], [-0.4, -0.04], [-0.43, -0.04], [-0.43, 0.08], [-0.25, 0.1]], 0.044, m.polymer, { bevel: 0.006 });
    b.box(0.016, 0.125, 0.048, m.polymer, -0.43, 0.02, { r: 0.006 });
    b.ext([[-0.02, 0.025], [0.035, 0.025], [0.012, -0.09], [-0.035, -0.095], [-0.048, -0.08]], 0.034, m.grip, { bevel: 0.004 });
    b.box(0.06, 0.03, 0.052, m.ceramic, -0.02, 0.06, { r: 0.006, x: 0 });
    b.irons(0.7, 0.14, 0.1);
    b.g.userData.muzzle.set(0, 0.083, -0.73);
    b.g.userData.fore.set(0, 0.02, -0.42);
  },
  creaminator(b) {
    const m = b.m;
    b.ext([[-0.12, 0.02], [0.28, 0.02], [0.3, 0.05], [0.3, 0.1], [-0.12, 0.1]], 0.058, m.olive, { bevel: 0.006 });
    b.box(0.13, 0.04, 0.04, m.gunmetal, 0.0, 0.1, { r: 0.012 });
    b.tube(0.007, 0.05, m.gunmetal, -0.03, 0.11, { x: 0.04 });
    b.put(new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 10), m.gunmetal), -0.03, 0.11, 0.065);
    b.tube(0.018, 0.56, m.gunmetal, 0.58, 0.07, { r2: 0.014 });
    for (let i = 0; i < 6; i++) b.tube(0.0185, 0.006, m.steel, 0.34 + i * 0.06, 0.07);
    b.lathe([[0.012, 0], [0.024, 0.01], [0.024, 0.07], [0.018, 0.075]], m.polymer, 0.86, 0.07, { alongBarrel: true });
    b.ext([[-0.12, 0.1], [-0.12, 0.02], [-0.2, -0.05], [-0.48, -0.05], [-0.5, 0.0], [-0.5, 0.11], [-0.36, 0.12], [-0.28, 0.08], [-0.2, 0.08], [-0.2, 0.1]], 0.05, m.olive, { bevel: 0.006 });
    b.box(0.02, 0.17, 0.054, m.polymer, -0.505, 0.03, { r: 0.008 });
    b.tube(0.03, 0.12, m.milk, -0.35, 0.03);
    b.tube(0.031, 0.02, m.blue, -0.29, 0.03);
    b.ext([[-0.02, 0.02], [0.03, 0.02], [0.012, -0.09], [-0.035, -0.095], [-0.05, -0.08]], 0.034, m.grip, { bevel: 0.004 });
    const mag = new THREE.Group();
    b.box(0.08, 0.08, 0.036, m.ceramic, 0.1, -0.02, { parent: mag, r: 0.006 });
    b.g.add(mag);
    b.g.userData.mag = mag;
    for (const s of [-1, 1]) {
      const leg = b.tube(0.005, 0.16, m.gunmetal, 0.33, 0.02, { x: s * 0.02 });
      leg.rotation.x = 0;
    }
    b.scope(0.02, 0.158, 0.3);
    b.g.userData.muzzle.set(0, 0.07, -0.95);
    b.g.userData.fore.set(0, 0.03, -0.25);
  },
  udder9(b) {
    const m = b.m;
    b.ext([[-0.05, 0.035], [0.13, 0.035], [0.13, 0.075], [0.11, 0.082], [-0.045, 0.082], [-0.05, 0.075]], 0.03, m.gunmetal, { bevel: 0.003 });
    for (let i = 0; i < 5; i++) b.box(0.003, 0.03, 0.034, m.polymer, -0.035 + i * 0.008, 0.06, { r: 0.0008 });
    b.box(0.06, 0.012, 0.006, m.pink, 0.04, 0.062, { x: 0.016, r: 0.002 });
    b.ext([[-0.04, 0.04], [0.12, 0.04], [0.12, 0.02], [0.03, 0.015], [0.01, -0.01], [-0.04, 0.0]], 0.028, m.pink, { bevel: 0.003 });
    b.ext([[-0.035, 0.02], [0.02, 0.02], [0.004, -0.085], [-0.045, -0.09], [-0.052, -0.075]], 0.03, m.pink, { bevel: 0.004 });
    b.box(0.03, 0.05, 0.034, m.grip, -0.018, -0.03, { r: 0.004 });
    b.ext([[0.015, 0.02], [0.07, 0.02], [0.07, 0.012], [0.03, -0.012], [0.015, -0.005]], 0.008, m.pink, { bevel: 0.001 });
    b.tube(0.007, 0.012, m.steel, 0.135, 0.056);
    const mag = new THREE.Group();
    for (const [x, du] of [[-0.009, -0.008], [0.009, -0.008], [-0.009, -0.032], [0.009, -0.032]]) {
      const teat = b.lathe([[0.007, 0], [0.006, -0.012], [0.004, -0.02], [0, -0.022]], m.pink, du, -0.092, { x, seg: 10, parent: mag });
      teat.rotation.x = -0.2;
    }
    b.g.add(mag);
    b.g.userData.mag = mag;
    b.irons(0.12, -0.04, 0.082);
    b.g.userData.muzzle.set(0, 0.056, -0.14);
    b.g.userData.fore.set(-0.012, -0.045, 0.0);
  },
  deag(b) {
    const m = b.m;
    b.ext([[-0.07, 0.04], [0.19, 0.04], [0.19, 0.088], [0.17, 0.098], [-0.06, 0.098], [-0.07, 0.088]], 0.036, m.chrome, { bevel: 0.004 });
    for (let i = 0; i < 6; i++) b.box(0.004, 0.034, 0.04, m.steel, -0.055 + i * 0.01, 0.07, { r: 0.001 });
    b.box(0.22, 0.012, 0.012, m.steel, 0.06, 0.103, { r: 0.004 });
    b.ext([[-0.06, 0.042], [0.17, 0.042], [0.17, 0.02], [0.04, 0.015], [0.0, -0.01], [-0.06, 0.0]], 0.032, m.gunmetal, { bevel: 0.003 });
    b.ext([[-0.045, 0.02], [0.025, 0.02], [0.006, -0.1], [-0.055, -0.105], [-0.064, -0.09]], 0.036, m.grip, { bevel: 0.005 });
    b.ext([[0.018, 0.02], [0.08, 0.02], [0.08, 0.012], [0.035, -0.014], [0.018, -0.006]], 0.009, m.gunmetal, { bevel: 0.001 });
    for (const s of [-1, 1]) {
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.007, 0.04, 10), m.ceramic);
      horn.rotation.z = -s * 1.0;
      b.put(horn, -0.05, 0.103, s * 0.024);
    }
    const mag = new THREE.Group();
    b.box(0.036, 0.012, 0.034, m.gunmetal, -0.025, -0.1, { parent: mag, r: 0.003 });
    b.g.add(mag);
    b.g.userData.mag = mag;
    b.irons(0.175, -0.05, 0.109);
    b.g.userData.muzzle.set(0, 0.066, -0.2);
    b.g.userData.fore.set(-0.012, -0.05, 0.0);
  },
  hoof(b) {
    const m = b.m;
    b.ext([[0.0, 0.0], [0.03, 0.012], [0.12, 0.016], [0.22, 0.004], [0.27, -0.018], [0.21, -0.008], [0.1, -0.014], [0.03, -0.016]], 0.005, m.steel, { bevel: 0.0015 });
    b.box(0.02, 0.045, 0.03, m.gunmetal, -0.01, 0.0, { r: 0.004 });
    b.tube(0.016, 0.1, m.grip, -0.07, -0.002, { r2: 0.017 });
    const pommel = b.put(new THREE.Mesh(new THREE.SphereGeometry(0.024, 14, 10), m.polymer), -0.13, -0.002);
    pommel.scale.set(1, 0.85, 1.2);
    b.box(0.004, 0.03, 0.03, m.ceramic, -0.14, -0.002, { r: 0.001 });
    b.g.userData.muzzle = null;
  },
  butter(b) {
    const m = b.m;
    b.box(0.11, 0.045, 0.05, m.butter, 0.0, 0.02, { r: 0.006 });
    b.box(0.07, 0.049, 0.054, m.paper, -0.03, 0.02, { r: 0.006 });
    b.box(0.071, 0.012, 0.055, m.blue, -0.03, 0.02, { r: 0.002 });
    b.box(0.01, 0.02, 0.02, m.gunmetal, -0.07, 0.055, { r: 0.004 });
    b.g.userData.muzzle = null;
  },
  smoke(b) {
    const m = b.m;
    b.ext([[-0.035, -0.05], [0.035, -0.05], [0.035, 0.05], [0.0, 0.085], [-0.035, 0.05]], 0.07, m.carton, { bevel: 0.002 });
    b.box(0.072, 0.025, 0.074, m.paper, 0, 0.0, { r: 0.002 });
    b.box(0.03, 0.012, 0.074, m.ceramic, 0, 0.09, { r: 0.002 });
    b.g.userData.muzzle = null;
  },
  he(b) {
    const m = b.m;
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 0.05, 28, 1, false, 0, Math.PI * 1.7), m.wax);
    b.put(wheel, 0, 0.02).rotation.x = Math.PI / 2;
    const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.051, 28, 1, false, Math.PI * 1.7, Math.PI * 0.3), m.cheese);
    b.put(inner, 0, 0.02).rotation.x = Math.PI / 2;
    b.tube(0.008, 0.02, m.gunmetal, 0, 0.08);
    b.box(0.02, 0.012, 0.03, m.gunmetal, 0, 0.09, { r: 0.004 });
    b.g.userData.muzzle = null;
  },
  molotov(b) {
    const m = b.m;
    b.lathe([[0, -0.07], [0.034, -0.07], [0.037, -0.06], [0.037, 0.02], [0.016, 0.05], [0.012, 0.09], [0.014, 0.1], [0, 0.1]], m.amber, 0, 0);
    b.lathe([[0, -0.06], [0.033, -0.06], [0.033, 0.0], [0, 0.0]], m.cheese, 0, 0);
    const rag = b.ext([[-0.012, 0.0], [0.012, 0.0], [0.03, 0.05], [-0.01, 0.04]], 0.02, m.cheese, { bevel: 0.002 });
    rag.position.y = 0.1;
    b.g.userData.muzzle = null;
  },
  cowblock(b) {
    const m = b.m;
    b.box(0.13, 0.13, 0.13, m.spots, 0, 0.02, { r: 0.012 });
    b.box(0.03, 0.05, 0.09, m.pink, 0.07, 0.0, { r: 0.012 });
    for (const x of [-0.03, 0.03]) b.put(new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), m.polymer), 0.066, 0.05, x);
    b.g.userData.muzzle = null;
  },
  bomb(b) {
    const m = b.m;
    b.lathe([[0, 0], [0.06, 0], [0.065, 0.01], [0.065, 0.13], [0.03, 0.17], [0.022, 0.2], [0, 0.2]], m.ceramic, 0, -0.05, { seg: 20 });
    b.tube(0.024, 0.012, m.blue, 0, 0.155, {}).rotation.x = 0;
    b.box(0.018, 0.08, 0.1, m.polymer, 0.066, 0.03, { r: 0.006 });
    b.box(0.004, 0.02, 0.05, m.led, 0.076, 0.055, { r: 0.001 });
    for (let i = 0; i < 9; i++) b.box(0.004, 0.012, 0.014, m.gunmetal, 0.077, 0.02 - Math.floor(i / 3) * 0.018, { x: -0.02 + (i % 3) * 0.02, r: 0.001 });
    for (const [x, mat] of [[-0.02, m.red], [0, m.blue], [0.02, m.cheese]]) b.tube(0.003, 0.14, mat, 0.066, 0.09, { x }).rotation.x = 0.3;
    const led = b.put(new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), m.led), 0.07, 0.085, 0.035);
    b.g.userData.led = led;
    b.g.userData.muzzle = null;
  },
};

export function buildWeaponMesh(id) {
  const b = new Gun();
  (BUILDERS[id] || BUILDERS.udder9)(b);
  return b.done();
}

export const SMALL_ITEMS = new Set(['udder9', 'deag', 'hoof', 'butter', 'smoke', 'he', 'molotov', 'bomb', 'cowblock']);

// ─── Weapon icons (rendered silhouettes for the HUD) ─────────────
let iconRenderer = null;
const iconCache = new Map();
export function weaponIcon(id) {
  if (iconCache.has(id)) return iconCache.get(id);
  try {
    if (!iconRenderer) {
      const c = document.createElement('canvas');
      c.width = 256; c.height = 96;
      iconRenderer = new THREE.WebGLRenderer({ canvas: c, alpha: true, antialias: true, preserveDrawingBuffer: true });
      iconRenderer.setClearColor(0x000000, 0);
    }
    const scene = new THREE.Scene();
    const mesh = buildWeaponMesh(id);
    scene.add(mesh);
    scene.overrideMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const box = new THREE.Box3().setFromObject(mesh);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const aspect = 256 / 96;
    const halfW = Math.max(size.z / 2, (size.y / 2) * aspect) * 1.08;
    const cam = new THREE.OrthographicCamera(-halfW, halfW, halfW / aspect, -halfW / aspect, 0.01, 10);
    cam.position.set(center.x + 2, center.y, center.z);
    cam.lookAt(center);
    iconRenderer.render(scene, cam);
    const url = iconRenderer.domElement.toDataURL();
    iconCache.set(id, url);
    return url;
  } catch {
    iconCache.set(id, '');
    return '';
  }
}

// ─── Hands ────────────────────────────────────────────────────
function buildArm(team, hand, shoulder, gripRot = 0) {
  const m = mats();
  const sleeveMat = new THREE.MeshStandardMaterial({ color: team === 'CT' ? 0x2b3f5c : 0x5c4a33, roughness: 0.85 });
  const cuffMat = new THREE.MeshStandardMaterial({ color: team === 'CT' ? 0x22324a : 0x4a3b28, roughness: 0.9 });
  const furMat = new THREE.MeshStandardMaterial({ color: team === 'CT' ? 0xefebe2 : 0x6b3f22, roughness: 0.95 });
  const dir = new THREE.Vector3().subVectors(shoulder, hand);
  const len = dir.length();
  const arm = new THREE.Group();
  const fur = new THREE.Mesh(new THREE.CapsuleGeometry(0.034, 0.06, 4, 12), furMat);
  fur.position.y = 0.06;
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.058, len - 0.1, 14), sleeveMat);
  sleeve.position.y = 0.1 + (len - 0.1) / 2;
  const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.047, 0.012, 8, 18), cuffMat);
  cuff.rotation.x = Math.PI / 2;
  cuff.position.y = 0.11;
  const glove = new THREE.Group();
  const palm = new THREE.Mesh(new RoundedBoxGeometry(0.07, 0.08, 0.05, 2, 0.018), m.glove);
  const fingers = new THREE.Mesh(new RoundedBoxGeometry(0.074, 0.045, 0.06, 2, 0.02), m.glove);
  fingers.position.set(0, -0.045, -0.018);
  fingers.rotation.x = 0.5;
  const knuckle = new THREE.Mesh(new RoundedBoxGeometry(0.066, 0.02, 0.02, 2, 0.008), m.gloveKnuckle);
  knuckle.position.set(0, -0.02, -0.03);
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.013, 0.04, 4, 8), m.glove);
  thumb.position.set(-0.035, -0.02, -0.02);
  thumb.rotation.z = 0.6;
  const strap = new THREE.Mesh(new RoundedBoxGeometry(0.076, 0.016, 0.056, 2, 0.006), m.gloveKnuckle);
  strap.position.y = 0.035;
  glove.add(palm, fingers, knuckle, thumb, strap);
  glove.rotation.y = gripRot;
  arm.add(glove, fur, sleeve, cuff);
  arm.position.copy(hand);
  arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return arm;
}

function flashTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.3, 'rgba(255,246,220,0.9)');
  g.addColorStop(1, 'rgba(255,230,180,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  for (let i = 0; i < 20; i++) {
    const a = (i / 20) * Math.PI * 2;
    const r = i % 2 ? 20 : 52 + Math.random() * 12;
    ctx.lineTo(64 + Math.cos(a) * r, 64 + Math.sin(a) * r);
  }
  ctx.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(54, 1, 0.005, 10);
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight(0xfff1dc, 0x3a3630, 1.3));
    const key = new THREE.DirectionalLight(0xfff4e0, 2.4);
    key.position.set(0.6, 1, 0.4);
    const rim = new THREE.DirectionalLight(0xaaccff, 1.2);
    rim.position.set(-0.8, 0.3, -0.6);
    this.scene.add(key, rim);
    this.root = new THREE.Group();
    this.camera.add(this.root);
    this.hip = new THREE.Vector3(0.11, -0.11, -0.3);
    this.team = 'T';
    this.cache = new Map();
    this.current = null;
    this.id = null;
    this.t = 0;
    this.bobPhase = 0;
    this.kick = 0;
    this.kickRot = 0;
    this.sway = new THREE.Vector2();
    this.drawT = 1;
    this.reloadT = 0;
    this.reloadDur = 0;
    this.swingT = 1;
    this.swingAlt = false;
    this.throwT = 1;
    this.inspectT = 1;
    this.pumpT = 1;
    this.placeT = 1;
    this.drops = [];
    this.reloadStyle = 'mag';
    this.magDropped = false;
    this.adsT = 0;
    this.adsPos = new THREE.Vector3();

    const flashMat = new THREE.SpriteMaterial({ map: flashTexture(), color: 0xfff6e0, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
    this.flash = new THREE.Sprite(flashMat);
    this.flash.visible = false;
    this.flashLight = new THREE.PointLight(0xfff2c0, 0, 1.5);
    this.scene.add(this.flashLight);
    this.flashUntil = 0;
  }

  setAspect(a) { this.camera.aspect = a; this.camera.updateProjectionMatrix(); }

  setTeam(team) {
    if (team === this.team) return;
    this.team = team;
    this.cache.clear();
    const id = this.id;
    this.id = null;
    if (id) this.setWeapon(id, true);
  }

  build(id) {
    const key = `${id}:${this.team}`;
    if (this.cache.has(key)) return this.cache.get(key);
    const holder = new THREE.Group();
    const gun = buildWeaponMesh(id);
    holder.add(gun);
    const nade = ['butter', 'smoke', 'he', 'molotov', 'bomb', 'hoof', 'cowblock'].includes(id);
    holder.add(buildArm(this.team, new THREE.Vector3(0.005, -0.02, 0.02), new THREE.Vector3(0.16, -0.5, 0.5), -0.2));
    if (!nade) {
      const fore = gun.userData.fore.clone().add(new THREE.Vector3(-0.004, -0.028, 0));
      const left = buildArm(this.team, fore, new THREE.Vector3(-0.32, -0.52, 0.28), 0.4);
      left.userData.base = left.position.clone();
      holder.userData.leftArm = left;
      holder.add(left);
    }
    holder.userData.gun = gun;
    this.cache.set(key, holder);
    return holder;
  }

  setWeapon(id, instant = false) {
    if (this.id === id) return;
    this.id = id;
    this.resetReloadPose();
    if (this.current) this.root.remove(this.current);
    this.current = this.build(id);
    this.root.add(this.current);
    const gun = this.current.userData.gun;
    if (gun.userData.muzzle) {
      gun.add(this.flash);
      this.flash.position.copy(gun.userData.muzzle);
    }
    this.drawT = instant ? 1 : 0;
    this.reloadT = 0;
    this.reloadDur = 0;
    this.swingT = 1;
    this.throwT = 1;
    this.inspectT = 1;
    if (gun.userData.mag) gun.userData.magBase = gun.userData.mag.position.clone();
    const small = SMALL_ITEMS.has(id);
    this.hip.set(small ? 0.1 : 0.12, small ? -0.115 : -0.13, small ? -0.4 : -0.36);
    const scale = id === 'bomb' ? 1.1 : ['butter', 'smoke', 'he', 'molotov'].includes(id) ? 1.3 : 1;
    this.current.scale.setScalar(scale);
    const s = gun.userData.sight;
    if (s) {
      const eyeDist = small ? 0.36 : id === 'creaminator' ? 0.22 : 0.34;
      this.adsPos.set(-s.x * scale, -s.y * scale, -eyeDist - s.z * scale);
    }
  }

  fire(strength = 1) {
    const ads = this.adsT;
    this.kick = Math.min(0.08, this.kick + 0.022 * strength * (1 - ads * 0.4));
    this.kickRot = Math.min(0.35, this.kickRot + 0.055 * strength * (1 - ads * 0.7));
    this.flash.visible = true;
    this.flash.material.rotation = Math.random() * Math.PI;
    this.flash.scale.setScalar((0.08 + Math.random() * 0.05) * Math.min(1.8, strength) * (1 - ads * 0.55));
    this.flashUntil = this.t + 0.04;
    this.flashLight.intensity = 2.5;
  }

  reload(dur, style = 'mag') {
    this.resetReloadPose();
    this.reloadT = 0;
    this.reloadDur = dur;
    this.reloadStyle = style;
    this.magDropped = false;
  }
  pump() { this.pumpT = 0; }
  place() { this.placeT = 0; }
  swing(alt) { this.swingT = 0; this.swingAlt = alt; }
  throwAnim() { this.throwT = 0; }
  inspect() {
    if (this.adsT > 0.05 || this.reloadDur > 0 || this.throwT < 1 || this.swingT < 1) return;
    this.inspectT = 0;
  }
  cancelReload() { this.reloadDur = 0; this.resetReloadPose(); }

  update(dt, s) {
    this.t += dt;
    if (!this.current) return;
    const r = this.root;
    const gun = this.current.userData.gun;
    const canAds = !!gun.userData.sight && s.ads && this.reloadDur <= 0 && this.drawT >= 1;
    this.adsT += ((canAds ? 1 : 0) - this.adsT) * Math.min(1, dt * 13);
    if (this.adsT < 0.001) this.adsT = 0;
    const ads = easeInOut(this.adsT);

    const speed = Math.min(1, s.speed / 6);
    this.bobPhase += dt * (4 + speed * 7) * (s.speed > 0.3 ? 1 : 0.25);
    const bobK = speed * (s.onGround ? 1 : 0.2) * (1 - ads * 0.85);
    const bobX = Math.sin(this.bobPhase) * 0.012 * bobK;
    const bobY = -Math.abs(Math.cos(this.bobPhase)) * 0.01 * bobK + Math.sin(this.t * 1.6) * 0.0012 * (1 - ads);

    this.sway.x += ((-s.lookDX * 0.0005) - this.sway.x) * Math.min(1, dt * 8);
    this.sway.y += ((s.lookDY * 0.0005) - this.sway.y) * Math.min(1, dt * 8);
    this.sway.x = THREE.MathUtils.clamp(this.sway.x, -0.04, 0.04);
    this.sway.y = THREE.MathUtils.clamp(this.sway.y, -0.04, 0.04);
    const swayK = 1 - ads * 0.75;

    this.kick *= Math.exp(-dt * 14);
    this.kickRot *= Math.exp(-dt * 12);

    const hipX = this.hip.x + bobX + this.sway.x * swayK;
    const hipY = this.hip.y + bobY + this.sway.y * swayK - (s.crouch ? 0.008 : 0) + (s.onGround ? 0 : 0.012);
    r.position.set(
      THREE.MathUtils.lerp(hipX, this.adsPos.x + bobX + this.sway.x * swayK, ads),
      THREE.MathUtils.lerp(hipY, this.adsPos.y + bobY + this.sway.y * swayK, ads),
      THREE.MathUtils.lerp(this.hip.z, this.adsPos.z, ads) + this.kick,
    );
    const knife = this.id === 'hoof';
    const hipRotY = knife ? 0.35 : 0.04;
    r.rotation.set(
      this.kickRot * 0.5 + this.sway.y * 2 * swayK + (knife ? 0.55 : 0),
      hipRotY * (1 - ads) + this.sway.x * 3 * swayK,
      bobX * 2 + (1 - ads) * (knife ? 0.35 : -0.02),
    );
    this.camera.fov = THREE.MathUtils.lerp(64, 50, ads);
    this.camera.updateProjectionMatrix();

    if (this.drawT < 1) {
      this.drawT = Math.min(1, this.drawT + dt / 0.45);
      const e = 1 - Math.pow(1 - this.drawT, 3);
      r.position.y -= (1 - e) * 0.22;
      r.rotation.x -= (1 - e) * 0.9;
      r.rotation.z += (1 - e) * 0.3;
    }
    if (this.reloadDur > 0) {
      this.reloadT += dt;
      const p = Math.min(1, this.reloadT / this.reloadDur);
      this.animateReload(p, r, gun);
      if (p >= 1) {
        this.reloadDur = 0;
        this.resetReloadPose();
      }
    }
    if (this.pumpT < 1) {
      this.pumpT = Math.min(1, this.pumpT + dt / 0.35);
      const k = Math.sin(this.pumpT * Math.PI);
      r.position.z += k * 0.025;
      r.rotation.x += k * 0.08;
      const pumpPart = gun.userData.mag;
      if (pumpPart && gun.userData.magBase) {
        pumpPart.position.z = gun.userData.magBase.z + k * 0.07;
        if (this.pumpT >= 1) pumpPart.position.copy(gun.userData.magBase);
      }
    }
    if (this.placeT < 1) {
      this.placeT = Math.min(1, this.placeT + dt / 0.22);
      const k = Math.sin(this.placeT * Math.PI);
      r.position.z -= k * 0.06;
      r.rotation.x -= k * 0.35;
    }
    this.updateDrops(dt);
    if (this.swingT < 1) {
      this.swingT = Math.min(1, this.swingT + dt / (this.swingAlt ? 0.55 : 0.32));
      const k = Math.sin(this.swingT * Math.PI);
      if (this.swingAlt) {
        r.rotation.x -= k * 1.1;
        r.position.z -= k * 0.12;
      } else {
        r.rotation.y += k * 0.9;
        r.rotation.z += k * 0.6;
        r.position.x -= k * 0.14;
        r.position.z -= k * 0.08;
      }
    }
    if (this.throwT < 1) {
      this.throwT = Math.min(1, this.throwT + dt / 0.45);
      const k = Math.sin(this.throwT * Math.PI);
      r.rotation.x -= k * 1.3;
      r.position.y += k * 0.1;
      this.current.visible = this.throwT > 0.55;
    } else {
      this.current.visible = true;
    }
    if (s.prime) {
      r.position.y += 0.05;
      r.position.z += 0.08;
      r.rotation.x -= 0.4;
    }
    if (this.inspectT < 1) {
      this.inspectT = Math.min(1, this.inspectT + dt / 1.25);
      const k = Math.sin(this.inspectT * Math.PI);
      r.position.x += 0.075 * k;
      r.position.y += 0.035 * k;
      r.position.z += 0.06 * k;
      r.rotation.x += 0.18 * k;
      r.rotation.y -= 0.75 * k;
      r.rotation.z += 0.1 * k;
    }
    if (gun.userData.led) gun.userData.led.visible = Math.sin(this.t * 12) > 0;
    if (s.using) {
      r.rotation.x += 0.6;
      r.position.y -= 0.08;
    }
    if (this.t > this.flashUntil) {
      this.flash.visible = false;
      this.flashLight.intensity = 0;
    } else {
      this.flash.getWorldPosition(this.flashLight.position);
    }
    this.root.visible = !s.hidden;
  }

  /** Staged reload: tilt → old mag out & dropped → hand fetches new mag → seat → rack. */
  animateReload(p, r, gun) {
    const style = this.reloadStyle || 'mag';
    const left = this.current.userData.leftArm;
    const mag = gun.userData.mag;
    const base = gun.userData.magBase;
    const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const bump = (a, b, x) => (x > a && x < b ? Math.sin(((x - a) / (b - a)) * Math.PI) : 0);
    if (style === 'shell') {
      const tilt = ss(0, 0.2, p) * (1 - ss(0.8, 1, p));
      r.rotation.z -= tilt * 0.45;
      r.rotation.x += tilt * 0.12;
      r.position.y -= tilt * 0.03;
      if (left?.userData.base) {
        const push = bump(0.2, 0.85, p);
        left.position.set(left.userData.base.x, left.userData.base.y - 0.05 * push, left.userData.base.z + 0.08 * push);
      }
      r.position.y += bump(0.6, 0.8, p) * 0.01;
      return;
    }
    const pistol = style === 'pistol';
    const tilt = ss(0, 0.15, p) * (1 - ss(0.86, 1, p));
    r.rotation.z += tilt * (pistol ? 0.35 : 0.55);
    r.rotation.x += tilt * 0.22;
    r.position.y -= tilt * 0.035;
    r.position.x -= tilt * 0.02;
    if (mag && base) {
      if (p < 0.18) {
        mag.visible = true;
        mag.position.copy(base);
        mag.position.y -= ss(0.1, 0.18, p) * 0.03;
      } else if (p < 0.45) {
        if (!this.magDropped) this.dropMag(mag);
        mag.visible = false;
      } else if (p < 0.7) {
        const k = ss(0.45, 0.7, p);
        mag.visible = true;
        mag.position.set(base.x, base.y - 0.22 * (1 - k), base.z + 0.04 * (1 - k));
      } else {
        mag.visible = true;
        mag.position.copy(base);
      }
    }
    r.position.y += bump(0.68, 0.76, p) * 0.015;
    if (left?.userData.base) {
      const reach = bump(0.25, 0.72, p);
      left.position.set(left.userData.base.x, left.userData.base.y - 0.16 * reach, left.userData.base.z + 0.06 * reach);
    }
    const rack = bump(0.76, 0.92, p);
    r.position.z += rack * (pistol ? 0.02 : 0.035);
    r.rotation.x -= rack * 0.1;
  }

  dropMag(mag) {
    this.magDropped = true;
    const clone = mag.clone();
    mag.updateMatrixWorld(true);
    mag.matrixWorld.decompose(clone.position, clone.quaternion, clone.scale);
    this.scene.add(clone);
    this.drops.push({ obj: clone, vy: -0.4, vx: -0.12, spin: 4 + Math.random() * 4, life: 0.7 });
  }

  updateDrops(dt) {
    if (!this.drops.length) return;
    for (const d of this.drops) {
      d.life -= dt;
      d.vy -= 3.5 * dt;
      d.obj.position.y += d.vy * dt;
      d.obj.position.x += d.vx * dt;
      d.obj.rotation.x += d.spin * dt;
    }
    this.drops = this.drops.filter((d) => {
      if (d.life > 0) return true;
      this.scene.remove(d.obj);
      return false;
    });
  }

  resetReloadPose() {
    const holder = this.current;
    if (!holder) return;
    const gun = holder.userData.gun;
    if (gun.userData.mag && gun.userData.magBase) {
      gun.userData.mag.position.copy(gun.userData.magBase);
      gun.userData.mag.visible = true;
    }
    const left = holder.userData.leftArm;
    if (left?.userData.base) left.position.copy(left.userData.base);
  }

  muzzleOffset() {
    const gun = this.current?.userData.gun;
    if (!gun?.userData.muzzle) return new THREE.Vector3(0.12, -0.1, -0.8);
    this.root.updateMatrixWorld(true);
    const v = gun.userData.muzzle.clone();
    gun.localToWorld(v);
    return this.camera.worldToLocal(v);
  }

  render(renderer) {
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}
