// Weapons. Real glTF where we have it — first-person arm rigs (rifle, pistol) with authored draw /
// fire / reload animation, the M4 and SCAR-H — plus realistic procedural models for the rest.
// Everything shares one gun-space convention: barrel along -Z, up +Y, grip at the origin.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { gunModel, rigInstance } from './assets.js';

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
    ctx.fillStyle = '#5a3a22';
    ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 140; i++) {
      ctx.strokeStyle = `rgba(${30 + Math.random() * 30},${18 + Math.random() * 12},8,${0.15 + Math.random() * 0.3})`;
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
  const burlap = canvasTex(128, (ctx, s) => {
    ctx.fillStyle = '#8f7e5a';
    ctx.fillRect(0, 0, s, s);
    ctx.globalAlpha = 0.18;
    for (let y = 0; y < s; y += 3) { ctx.fillStyle = y % 6 ? '#000' : '#fff'; ctx.fillRect(0, y, s, 1); }
    for (let x = 0; x < s; x += 3) { ctx.fillStyle = x % 6 ? '#000' : '#fff'; ctx.fillRect(x, 0, 1, s); }
  }, [2, 2]);
  const std = (o) => new THREE.MeshStandardMaterial(o);
  M = {
    gunmetal: std({ color: 0x2c3036, roughness: 0.36, metalness: 0.85 }),
    black: std({ color: 0x17181b, roughness: 0.45, metalness: 0.6 }),
    polymer: std({ color: 0x1e2024, roughness: 0.72, metalness: 0.08 }),
    grip: std({ map: knurl, roughness: 0.85, metalness: 0.05 }),
    tan: std({ color: 0xa48c66, roughness: 0.62, metalness: 0.05 }),
    olive: std({ color: 0x4b5134, roughness: 0.6, metalness: 0.1 }),
    wood: std({ map: grain, roughness: 0.5, metalness: 0 }),
    steel: std({ color: 0xa9b1b8, roughness: 0.22, metalness: 1 }),
    chrome: std({ color: 0xd8dde2, roughness: 0.12, metalness: 1 }),
    ceramic: std({ color: 0xe8e6df, roughness: 0.4, metalness: 0 }),
    red: std({ color: 0x9e2a22, roughness: 0.45 }),
    blue: std({ color: 0x2a4f8f, roughness: 0.45 }),
    yellow: std({ color: 0xc9a227, roughness: 0.45 }),
    brass: std({ color: 0xc9a13b, roughness: 0.3, metalness: 1 }),
    m84: std({ color: 0x55594f, roughness: 0.5, metalness: 0.4 }),
    smokeCan: std({ color: 0x5c6150, roughness: 0.55, metalness: 0.3 }),
    od: std({ color: 0x4a5032, roughness: 0.55, metalness: 0.15 }),
    c4: std({ color: 0x8b8460, roughness: 0.85 }),
    tape: std({ color: 0x18191a, roughness: 0.6 }),
    burlap: std({ map: burlap, roughness: 1 }),
    bottle: std({ color: 0x3c5a2a, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.8 }),
    fuel: std({ color: 0x7a5a1c, roughness: 0.2, transparent: true, opacity: 0.85 }),
    rag: std({ color: 0xbfb6a2, roughness: 1 }),
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
  // Generic AR-pattern rifle — fallback for the M4 / SCAR-H if their models are unavailable.
  rifle(b) {
    const m = b.m;
    b.ext([[-0.1, 0.055], [0.19, 0.055], [0.19, 0.1], [-0.1, 0.1]], 0.046, m.black);
    b.ext([[-0.1, 0.055], [0.17, 0.055], [0.15, 0.0], [0.05, 0.0], [0.0, 0.02], [-0.1, 0.02]], 0.044, m.black, { bevel: 0.004 });
    b.rail(-0.1, 0.19, 0.104);
    b.tube(0.015, 0.2, m.polymer, -0.2, 0.075);
    b.ext([[-0.24, 0.1], [-0.2, 0.09], [-0.2, 0.05], [-0.26, -0.02], [-0.38, -0.02], [-0.38, 0.1]], 0.04, m.polymer, { bevel: 0.006 });
    b.box(0.012, 0.11, 0.044, m.polymer, -0.382, 0.04, { r: 0.004 });
    b.ext([[-0.015, 0.02], [0.035, 0.02], [0.012, -0.09], [-0.035, -0.095], [-0.045, -0.083]], 0.032, m.grip, { bevel: 0.004 });
    b.box(0.26, 0.052, 0.052, m.black, 0.32, 0.075, { r: 0.01 });
    b.rail(0.19, 0.45, 0.104);
    b.tube(0.0085, 0.2, m.gunmetal, 0.55, 0.075);
    b.tube(0.012, 0.05, m.black, 0.67, 0.075);
    const mag = new THREE.Group();
    b.ext([[0.07, 0.02], [0.135, 0.02], [0.15, -0.15], [0.085, -0.155]], 0.028, m.polymer, { bevel: 0.003, parent: mag });
    b.g.add(mag);
    b.g.userData.mag = mag;
    b.holo(0.02, 0.137);
    b.g.userData.muzzle.set(0, 0.075, -0.7);
    b.g.userData.fore.set(0, 0.035, -0.32);
  },
  shotgun(b) {
    const m = b.m;
    b.ext([[-0.1, 0.02], [0.18, 0.02], [0.18, 0.1], [-0.08, 0.1], [-0.1, 0.085]], 0.05, m.black);
    b.box(0.004, 0.03, 0.052, m.steel, 0.05, 0.07, { r: 0.001 });
    b.tube(0.0165, 0.55, m.gunmetal, 0.45, 0.083);
    b.tube(0.0145, 0.45, m.gunmetal, 0.4, 0.045);
    b.tube(0.017, 0.012, m.steel, 0.7, 0.045);
    for (const u of [0.3, 0.58]) b.box(0.012, 0.06, 0.028, m.gunmetal, u, 0.064, { r: 0.004 });
    const pump = new THREE.Group();
    b.tube(0.026, 0.16, m.polymer, 0.42, 0.045, { parent: pump, seg: 16 });
    for (let i = 0; i < 6; i++) b.tube(0.0275, 0.008, m.black, 0.36 + i * 0.024, 0.045, { parent: pump, seg: 16 });
    b.g.add(pump);
    b.g.userData.mag = pump;
    b.ext([[-0.1, 0.095], [-0.1, 0.03], [-0.4, -0.04], [-0.43, -0.04], [-0.43, 0.08], [-0.25, 0.1]], 0.044, m.polymer, { bevel: 0.006 });
    b.box(0.016, 0.125, 0.048, m.polymer, -0.43, 0.02, { r: 0.006 });
    b.ext([[-0.02, 0.025], [0.035, 0.025], [0.012, -0.09], [-0.035, -0.095], [-0.048, -0.08]], 0.034, m.grip, { bevel: 0.004 });
    for (let i = 0; i < 4; i++) b.tube(0.007, 0.03, m.red, -0.08 + i * 0.022, 0.06, { x: 0.03 }); // side saddle shells
    b.irons(0.7, 0.14, 0.1);
    b.g.userData.muzzle.set(0, 0.083, -0.73);
    b.g.userData.fore.set(0, 0.02, -0.42);
  },
  sniper(b) {
    const m = b.m;
    b.ext([[-0.12, 0.02], [0.28, 0.02], [0.3, 0.05], [0.3, 0.1], [-0.12, 0.1]], 0.058, m.olive, { bevel: 0.006 });
    b.box(0.13, 0.04, 0.04, m.gunmetal, 0.0, 0.1, { r: 0.012 });
    b.tube(0.007, 0.05, m.gunmetal, -0.03, 0.11, { x: 0.04 });
    b.put(new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 10), m.gunmetal), -0.03, 0.11, 0.065);
    b.tube(0.018, 0.56, m.gunmetal, 0.58, 0.07, { r2: 0.014 });
    b.lathe([[0.012, 0], [0.024, 0.01], [0.024, 0.07], [0.018, 0.075]], m.black, 0.86, 0.07, { alongBarrel: true });
    b.ext([[-0.12, 0.1], [-0.12, 0.02], [-0.2, -0.05], [-0.48, -0.05], [-0.5, 0.0], [-0.5, 0.11], [-0.36, 0.12], [-0.28, 0.08], [-0.2, 0.08], [-0.2, 0.1]], 0.05, m.olive, { bevel: 0.006 });
    b.box(0.02, 0.17, 0.054, m.polymer, -0.505, 0.03, { r: 0.008 });
    b.box(0.12, 0.022, 0.05, m.polymer, -0.36, 0.13, { r: 0.006 }); // cheek riser
    b.ext([[-0.02, 0.02], [0.03, 0.02], [0.012, -0.09], [-0.035, -0.095], [-0.05, -0.08]], 0.034, m.grip, { bevel: 0.004 });
    const mag = new THREE.Group();
    b.box(0.08, 0.08, 0.036, m.black, 0.1, -0.02, { parent: mag, r: 0.006 });
    b.g.add(mag);
    b.g.userData.mag = mag;
    for (const s of [-1, 1]) b.tube(0.005, 0.16, m.gunmetal, 0.33, 0.02, { x: s * 0.02 });
    b.scope(0.02, 0.158, 0.3);
    b.g.userData.muzzle.set(0, 0.07, -0.95);
    b.g.userData.fore.set(0, 0.03, -0.25);
  },
  // Polymer service pistol — fallback for the P9 / .50 Magnum.
  pistol(b) {
    const m = b.m;
    b.ext([[-0.05, 0.035], [0.13, 0.035], [0.13, 0.075], [0.11, 0.082], [-0.045, 0.082], [-0.05, 0.075]], 0.03, m.black, { bevel: 0.003 });
    for (let i = 0; i < 5; i++) b.box(0.003, 0.03, 0.034, m.polymer, -0.035 + i * 0.008, 0.06, { r: 0.0008 });
    b.ext([[-0.04, 0.04], [0.12, 0.04], [0.12, 0.02], [0.03, 0.015], [0.01, -0.01], [-0.04, 0.0]], 0.028, m.polymer, { bevel: 0.003 });
    b.ext([[-0.035, 0.02], [0.02, 0.02], [0.004, -0.085], [-0.045, -0.09], [-0.052, -0.075]], 0.03, m.polymer, { bevel: 0.004 });
    b.box(0.03, 0.05, 0.034, m.grip, -0.018, -0.03, { r: 0.004 });
    b.tube(0.007, 0.012, m.steel, 0.135, 0.056);
    const mag = new THREE.Group();
    b.box(0.032, 0.012, 0.03, m.black, -0.022, -0.092, { parent: mag, r: 0.003 });
    b.g.add(mag);
    b.g.userData.mag = mag;
    b.irons(0.12, -0.04, 0.082);
    b.g.userData.muzzle.set(0, 0.056, -0.14);
    b.g.userData.fore.set(-0.012, -0.045, 0.0);
  },
  knife(b) {
    const m = b.m;
    b.ext([[0.0, 0.0], [0.03, 0.012], [0.12, 0.016], [0.22, 0.004], [0.27, -0.018], [0.21, -0.008], [0.1, -0.014], [0.03, -0.016]], 0.005, m.steel, { bevel: 0.0015 });
    b.ext([[0.03, 0.006], [0.2, 0.006], [0.2, 0.0], [0.03, 0.0]], 0.0052, m.gunmetal, { bevel: 0.0003 }); // fuller
    b.box(0.02, 0.045, 0.03, m.black, -0.01, 0.0, { r: 0.004 });
    b.tube(0.016, 0.1, m.grip, -0.07, -0.002, { r2: 0.017 });
    const pommel = b.put(new THREE.Mesh(new THREE.SphereGeometry(0.02, 14, 10), m.black), -0.13, -0.002);
    pommel.scale.set(1, 0.85, 1.2);
    b.g.userData.muzzle = null;
  },
  flashbang(b) { // M84-style: perforated cylinder, spoon, pull ring
    const m = b.m;
    b.tube(0.026, 0.11, m.m84, 0.0, 0.02, { seg: 18 });
    for (const u of [-0.03, 0.0, 0.03]) b.tube(0.0265, 0.008, m.black, u, 0.02, { seg: 18 }); // vent bands
    b.tube(0.014, 0.025, m.gunmetal, -0.067, 0.02);
    b.box(0.07, 0.006, 0.014, m.gunmetal, -0.03, 0.05, { r: 0.002 });
    b.put(new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.002, 6, 16), m.steel), -0.08, 0.045, 0.012);
    b.g.userData.muzzle = null;
  },
  smoke(b) { // M18-style canister
    const m = b.m;
    b.tube(0.03, 0.115, m.smokeCan, 0, 0.02, { seg: 20 });
    b.tube(0.0305, 0.02, m.red, -0.04, 0.02, { seg: 20 });
    b.tube(0.014, 0.022, m.gunmetal, -0.068, 0.02);
    b.box(0.08, 0.006, 0.014, m.gunmetal, -0.03, 0.054, { r: 0.002 });
    b.put(new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.002, 6, 16), m.steel), -0.085, 0.045, 0.012);
    b.g.userData.muzzle = null;
  },
  he(b) { // M67-style frag
    const m = b.m;
    b.put(new THREE.Mesh(new THREE.SphereGeometry(0.032, 20, 16), m.od), 0, 0.02);
    b.tube(0.012, 0.03, m.gunmetal, -0.035, 0.02);
    b.box(0.06, 0.006, 0.014, m.gunmetal, -0.01, 0.05, { r: 0.002 });
    b.put(new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.002, 6, 16), m.steel), -0.055, 0.045, 0.012);
    b.g.userData.muzzle = null;
  },
  molotov(b) {
    const m = b.m;
    b.lathe([[0, -0.07], [0.034, -0.07], [0.037, -0.06], [0.037, 0.02], [0.016, 0.05], [0.012, 0.09], [0.014, 0.1], [0, 0.1]], m.bottle, 0, 0);
    b.lathe([[0, -0.066], [0.033, -0.066], [0.033, 0.0], [0, 0.0]], m.fuel, 0, 0);
    const rag = b.ext([[-0.012, 0.0], [0.012, 0.0], [0.03, 0.05], [-0.01, 0.04]], 0.02, m.rag, { bevel: 0.002 });
    rag.position.y = 0.1;
    b.g.userData.muzzle = null;
  },
  barricade(b) { // a sandbag ready to be dropped
    const m = b.m;
    b.box(0.2, 0.09, 0.13, m.burlap, 0, 0.02, { r: 0.04 });
    b.box(0.02, 0.05, 0.05, m.burlap, 0.11, 0.03, { r: 0.01 });
    b.g.userData.muzzle = null;
  },
  bomb(b) { // C4: taped putty blocks, keypad, wires
    const m = b.m;
    for (let i = 0; i < 3; i++) b.box(0.14, 0.035, 0.05, m.c4, 0, -0.03 + i * 0.037, { r: 0.004 });
    for (const u of [-0.045, 0.045]) b.box(0.012, 0.115, 0.054, m.tape, u, 0.007, { r: 0.002 });
    b.box(0.07, 0.012, 0.045, m.black, 0, 0.065, { r: 0.004 });
    for (let i = 0; i < 9; i++) b.box(0.01, 0.004, 0.009, m.gunmetal, -0.02 + (i % 3) * 0.013, 0.073, { x: -0.013 + Math.floor(i / 3) * 0.012, r: 0.001 });
    b.box(0.02, 0.006, 0.012, m.led, 0.026, 0.073, { r: 0.001 });
    for (const [x, mat] of [[-0.016, m.red], [0, m.blue], [0.016, m.yellow]]) b.tube(0.0025, 0.12, mat, 0.0, 0.03, { x }).rotation.x = 0.3;
    const led = b.put(new THREE.Mesh(new THREE.SphereGeometry(0.005, 8, 6), m.led), 0.03, 0.074, 0.016);
    b.g.userData.led = led;
    b.g.userData.muzzle = null;
  },
};

// Weapons backed by a real model, and the procedural fallback used if it failed to load.
const MODEL_GUN = { carbine: 'm4', m4s: 'm4', scar: 'scar', p9: 'pistol', magnum: 'pistol' };
const FALLBACK = { carbine: 'rifle', m4s: 'rifle', scar: 'rifle', p9: 'pistol', magnum: 'pistol' };

/** Per-weapon touches on a shared model: the M4A1-S suppressor, the Magnum's polished finish. */
function decorate(g, id) {
  if (id === 'm4s') {
    const can = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.17, 18), mats().black);
    can.rotation.x = Math.PI / 2;
    can.position.copy(g.userData.muzzle).add(new THREE.Vector3(0, 0, -0.08));
    g.add(can);
    g.userData.muzzle.z -= 0.17;
  }
  if (id === 'magnum') {
    g.traverse((o) => {
      if (!o.isMesh) return;
      o.material = [].concat(o.material).map((m) => {
        const c = m.clone();
        if (c.metalness > 0.3) { c.color.set(0xc9ced3); c.metalness = 1; c.roughness = 0.18; }
        return c;
      });
      if (o.material.length === 1) o.material = o.material[0];
    });
    g.scale.setScalar(1.15);
    for (const k of ['muzzle', 'fore', 'sight']) g.userData[k]?.multiplyScalar(1.15);
  }
}

export function buildWeaponMesh(id) {
  const kind = MODEL_GUN[id];
  const model = kind && gunModel(kind);
  if (model) {
    decorate(model, id);
    return model;
  }
  const b = new Gun();
  (BUILDERS[FALLBACK[id] || id] || BUILDERS.pistol)(b);
  return b.done();
}

export const SMALL_ITEMS = new Set(['p9', 'magnum', 'knife', 'flashbang', 'smoke', 'he', 'molotov', 'bomb', 'barricade']);

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

// ─── Procedural arms (used only if the arm rigs failed to load) ─────
function buildArm(team, hand, shoulder, gripRot = 0) {
  const m = mats();
  const sleeveMat = new THREE.MeshStandardMaterial({ color: team === 'CT' ? 0x2d3440 : 0x5b5240, roughness: 0.9 });
  const dir = new THREE.Vector3().subVectors(shoulder, hand);
  const len = dir.length();
  const arm = new THREE.Group();
  const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.056, len - 0.06, 14), sleeveMat);
  sleeve.position.y = 0.06 + (len - 0.06) / 2;
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
  const cuff = new THREE.Mesh(new RoundedBoxGeometry(0.08, 0.03, 0.06, 2, 0.008), m.gloveKnuckle);
  cuff.position.y = 0.045;
  glove.add(palm, fingers, knuckle, thumb, cuff);
  glove.rotation.y = gripRot;
  arm.add(glove, sleeve);
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
  g.addColorStop(0.3, 'rgba(255,236,190,0.9)');
  g.addColorStop(1, 'rgba(255,200,120,0)');
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

// ─── First-person arm rigs ──────────────────────────────────────
// Which arms hold what. Long guns ride the rifle rig; pistols, the knife and throwables the pistol rig.
const RIG = {
  carbine: 'rifle', m4s: 'rifle', scar: 'rifle', shotgun: 'rifle', sniper: 'rifle',
  p9: 'pistol', magnum: 'pistol', knife: 'pistol', flashbang: 'pistol', smoke: 'pistol', he: 'pistol', molotov: 'pistol', bomb: 'pistol', barricade: 'pistol',
};
const NATIVE = { scar: 'rifle', p9: 'pistol', magnum: 'pistol' }; // weapons the rig itself carries
// Where the grip sits in camera space at the hip, per rig (tuned against the arm meshes).
const RIG_HIP = { rifle: new THREE.Vector3(0.14, -0.22, -0.52), pistol: new THREE.Vector3(0.11, -0.13, -0.42) };
const RIG_GUN = { rifle: { length: 1.0, gripFrac: 0.66, bore: 0.075 }, pistol: { length: 0.2, gripFrac: 0.72, bore: 0.06 } };

/**
 * Build a rig holding `id`. Holder space is made identical to gun space at the idle pose (grip at
 * the origin, barrel down -Z), so hip / ADS placement works exactly like the procedural guns.
 */
function buildRig(id) {
  const kind = RIG[id];
  const r = kind && rigInstance(kind);
  if (!r || !r.clips.idle) return null;
  const info = r.info, spec = RIG_GUN[kind];
  const idle = r.mixer.clipAction(r.clips.idle);
  idle.play();
  r.mixer.update(0);
  r.scene.updateMatrixWorld(true);

  const box = info.gunBox, rigLen = box.max.z - box.min.z;
  const k = rigLen / spec.length; // rig units per metre
  // Gun-space origin: on the bore axis's vertical offset, at the rig's grip hand (falls back to a
  // fixed fraction of the gun's length when the palms can't be measured).
  const gripZ = info.gripPalm ? info.gripPalm.z : box.min.z + rigLen * spec.gripFrac;
  const grip = new THREE.Vector3((box.min.x + box.max.x) / 2, info.bore - spec.bore * k, gripZ);
  const gunToRig = new THREE.Matrix4().compose(grip, new THREE.Quaternion(), new THREE.Vector3(k, k, k));

  let gun, muzzleWorld;
  if (NATIVE[id] === kind) {
    // Sight line: the top of the rig's own gun over its rear half, in gun space.
    let top = -Infinity;
    const v = new THREE.Vector3();
    r.scene.traverse((o) => {
      if (!o.isMesh || !info.gunMeshNames.includes(o.name)) return;
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < pos.count; i += 2) {
        o.getVertexPosition(i, v).applyMatrix4(o.matrixWorld);
        if (v.z > grip.z - rigLen * 0.25) top = Math.max(top, v.y);
      }
    });
    gun = new THREE.Object3D();
    gun.userData = { sight: new THREE.Vector3(0, (top - grip.y) / k - 0.004, -0.06 * (spec.length / 0.2 > 2 ? 2 : 1)), muzzle: null };
    const mesh = r.scene.getObjectByName(info.muzzle.mesh), idx = info.muzzle.index;
    muzzleWorld = (out) => { mesh.getVertexPosition(idx, out); return out.applyMatrix4(mesh.matrixWorld); };
    if (id === 'magnum') {
      r.scene.traverse((o) => {
        if (!o.isMesh || !info.gunMeshNames.includes(o.name)) return;
        o.material = o.material.clone();
        if (o.material.metalness > 0.3) { o.material.color.set(0xc9ced3); o.material.metalness = 1; o.material.roughness = 0.18; }
      });
    }
  } else {
    for (const n of info.gunMeshNames) { const o = r.scene.getObjectByName(n); if (o) o.visible = false; }
    gun = buildWeaponMesh(id);
    gun.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });
    const bone = (info.gunBone && r.scene.getObjectByName(info.gunBone)) || r.scene;
    const mount = new THREE.Group();
    mount.matrixAutoUpdate = false;
    mount.matrix.copy(bone.matrixWorld.clone().invert().multiply(gunToRig));
    mount.add(gun);
    bone.add(mount);
    muzzleWorld = (out) => (gun.userData.muzzle ? gun.localToWorld(out.copy(gun.userData.muzzle)) : null);
  }
  // Rig units → metres, grip → origin.
  r.scene.scale.setScalar(1 / k);
  r.scene.position.copy(grip).multiplyScalar(-1 / k);
  r.scene.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; } });

  const holder = new THREE.Group();
  holder.add(r.scene);
  holder.userData.gun = gun;
  holder.userData.muzzleWorld = muzzleWorld;
  holder.userData.rig = { kind, mixer: r.mixer, clips: r.clips, idle, actions: { idle }, oneShot: null };
  return holder;
}

export class ViewModel {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(54, 1, 0.01, 10);
    this.scene.add(this.camera);
    this.scene.add(new THREE.HemisphereLight(0xfff1dc, 0x3a3630, 1.1));
    const key = new THREE.DirectionalLight(0xfff4e0, 2.2);
    key.position.set(0.6, 1, 0.4);
    const rim = new THREE.DirectionalLight(0xaaccff, 1.0);
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
    this.tmp = new THREE.Vector3();

    const flashMat = new THREE.SpriteMaterial({ map: flashTexture(), color: 0xfff1d8, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
    this.flash = new THREE.Sprite(flashMat);
    this.flash.visible = false;
    this.scene.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffd9a0, 0, 2);
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
    if (this.cache.has(id)) return this.cache.get(id);
    let holder = buildRig(id);
    if (!holder) {
      holder = new THREE.Group();
      const gun = buildWeaponMesh(id);
      holder.add(gun);
      const item = SMALL_ITEMS.has(id) && !['p9', 'magnum'].includes(id);
      holder.add(buildArm(this.team, new THREE.Vector3(0.005, -0.02, 0.02), new THREE.Vector3(0.16, -0.5, 0.5), -0.2));
      if (!item) {
        const fore = (gun.userData.fore || new THREE.Vector3(0, 0, -0.3)).clone().add(new THREE.Vector3(-0.004, -0.028, 0));
        const left = buildArm(this.team, fore, new THREE.Vector3(-0.32, -0.52, 0.28), 0.4);
        left.userData.base = left.position.clone();
        holder.userData.leftArm = left;
        holder.add(left);
      }
      holder.userData.gun = gun;
      holder.userData.muzzleWorld = (out) => (gun.userData.muzzle ? gun.localToWorld(out.copy(gun.userData.muzzle)) : null);
    }
    this.cache.set(id, holder);
    return holder;
  }

  /** Play a one-shot rig clip stretched to `dur` seconds, then fall back to the idle loop. */
  playRig(name, dur, fade = 0.08) {
    const rig = this.current?.userData.rig;
    const clip = rig?.clips[name];
    if (!clip) return false;
    const a = rig.actions[name] || (rig.actions[name] = rig.mixer.clipAction(clip));
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = dur ? clip.duration / dur : 1;
    a.enabled = true;
    a.setEffectiveWeight(1);
    if (rig.oneShot && rig.oneShot.action !== a) rig.oneShot.action.fadeOut(fade);
    rig.idle.fadeOut(fade);
    a.fadeIn(fade).play();
    rig.oneShot = { action: a, end: this.t + (dur ?? clip.duration) };
    return true;
  }

  rigToIdle(fade = 0.15) {
    const rig = this.current?.userData.rig;
    if (!rig?.oneShot) return;
    rig.oneShot.action.fadeOut(fade);
    rig.idle.reset().fadeIn(fade).play();
    rig.oneShot = null;
  }

  setWeapon(id, instant = false) {
    if (this.id === id) return;
    this.id = id;
    this.resetReloadPose();
    if (this.current) this.root.remove(this.current);
    this.current = this.build(id);
    this.root.add(this.current);
    const gun = this.current.userData.gun;
    const rig = this.current.userData.rig;
    this.drawT = instant || rig ? 1 : 0;
    this.reloadT = 0;
    this.reloadDur = 0;
    this.swingT = 1;
    this.throwT = 1;
    this.inspectT = 1;
    if (rig) {
      rig.oneShot = null;
      rig.mixer.stopAllAction();
      rig.idle.reset().play();
      if (!instant) this.playRig('draw', 0.75, 0.01);
    }
    if (gun.userData.mag) gun.userData.magBase = gun.userData.mag.position.clone();
    const small = SMALL_ITEMS.has(id);
    if (rig) this.hip.copy(RIG_HIP[rig.kind]);
    else this.hip.set(small ? 0.1 : 0.12, small ? -0.115 : -0.13, small ? -0.4 : -0.36);
    const scale = rig ? 1 : id === 'bomb' ? 1.1 : ['flashbang', 'smoke', 'he', 'molotov'].includes(id) ? 1.3 : 1;
    this.current.scale.setScalar(scale);
    const s = gun.userData.sight;
    if (s) {
      const eyeDist = small ? 0.36 : id === 'sniper' ? 0.22 : 0.34;
      this.adsPos.set(-s.x * scale, -s.y * scale, -eyeDist - s.z * scale);
    }
  }

  fire(strength = 1) {
    const ads = this.adsT;
    const rig = this.current?.userData.rig;
    if (rig) this.playRig('fire', rig.kind === 'pistol' ? 0.28 : 0.2, 0.02);
    const k = rig ? 0.6 : 1; // the clip carries part of the recoil
    this.kick = Math.min(0.08, this.kick + 0.022 * strength * k * (1 - ads * 0.4));
    this.kickRot = Math.min(0.35, this.kickRot + 0.055 * strength * k * (1 - ads * 0.7));
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
    this.rigReload = style !== 'shell' && this.playRig('reload', dur, 0.12);
  }
  pump() { this.pumpT = 0; }
  place() { this.placeT = 0; }
  swing(alt) { this.swingT = 0; this.swingAlt = alt; }
  throwAnim() { this.throwT = 0; }
  inspect() {
    if (this.adsT > 0.05 || this.reloadDur > 0 || this.throwT < 1 || this.swingT < 1) return;
    this.inspectT = 0;
  }
  cancelReload() { this.reloadDur = 0; this.resetReloadPose(); if (this.rigReload) this.rigToIdle(); this.rigReload = false; }

  update(dt, s) {
    this.t += dt;
    if (!this.current) return;
    const r = this.root;
    const gun = this.current.userData.gun;
    const rig = this.current.userData.rig;
    if (rig) {
      if (rig.oneShot && this.t >= rig.oneShot.end) this.rigToIdle();
      rig.mixer.update(dt);
    }
    const canAds = !!gun.userData.sight && s.ads && this.reloadDur <= 0 && this.drawT >= 1 && !(rig?.oneShot && rig.oneShot.action === rig.actions.draw);
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
    const knife = this.id === 'knife';
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
      if (!this.rigReload) this.animateReload(p, r, gun);
      if (p >= 1) {
        this.reloadDur = 0;
        this.rigReload = false;
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
      this.camera.updateMatrixWorld(true);
      const m = this.current.userData.muzzleWorld?.(this.tmp);
      if (m) { this.flash.position.copy(m); this.flashLight.position.copy(m); }
    }
    this.root.visible = !s.hidden;
  }

  /** Procedural staged reload for guns without an animated rig (and shotgun shell loading). */
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
    this.camera.updateMatrixWorld(true);
    const m = this.current?.userData.muzzleWorld?.(new THREE.Vector3());
    if (!m) return new THREE.Vector3(0.12, -0.1, -0.8);
    return this.camera.worldToLocal(m);
  }

  render(renderer) {
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
  }
}
