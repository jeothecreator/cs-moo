// Assault Course — solo, client-side obstacle courses over open water.
// Plays the official 8-stage course or a community course built in the Course Creator.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { newBody, stepBody } from '/shared/physics.js';
import { PLAYER } from '/shared/constants.js';
import { BLOCK } from '/shared/obby.js';
import { makeTextures } from './textures.js';
import { SoldierModel } from './soldier.js';

export const OBBY_BASE = 20;
const BASE = OBBY_BASE;
const KILL_Y = BASE - 9;
const STAGES = ['Turf Hop', 'Rotor Sweep', 'Tank Express', 'Rotten Planks', 'Sandbag Bounce', 'Watchtower', 'Rafters', 'Barrel Run'];
const BEST_KEY = 'csmoo.obbyBest';
const BEST_DIST_KEY = 'csmoo.obbyBestDist';

export function formatRunTime(s) {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(2).padStart(5, '0')}`;
}

export function playerName() {
  return (document.getElementById('nameInput')?.value || '').trim().slice(0, 16) || 'Recruit';
}

export async function postJSON(url, body) {
  try {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await r.json().catch(() => null);
    return r.ok ? data : { error: data?.error || `Request failed (${r.status})` };
  } catch {
    return { error: 'Could not reach the server' };
  }
}

function canvasTex(draw, size = 256, repeat = true) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Box geometry whose UVs repeat once per `tile` metres. */
function tiledBox(w, h, d, tile = 2) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * Math.max(1, dims[f][0] / tile), uv.getY(i) * Math.max(1, dims[f][1] / tile));
    }
  }
  return g;
}

export class Obby {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.fromEditor = false;
    const $ = (id) => document.getElementById(id);
    this.el = {
      hud: $('obbyHud'), stage: $('obStage'), timer: $('obTimer'), deaths: $('obDeaths'), check: $('obCheck'),
      best: $('obBest'), progress: $('obProgress'), toast: $('obToast'), fade: $('obFade'), finish: $('obFinish'),
      finishTitle: $('obfTitle'), finishTime: $('obfTime'), finishSub: $('obfSub'), dash: $('obDash'),
      help: $('obHelp'), menuBtn: $('obMenu'),
    };
  }

  // ─── Shared scenery (built once) ─────────────────────────────
  ensureBase() {
    if (this.scene) return;
    const scene = (this.scene = new THREE.Scene());
    const renderer = this.game.renderer;
    const tex = (this.tex = makeTextures());

    scene.background = new THREE.Color(0x6fa9e0);
    scene.fog = new THREE.Fog(0xa9cdee, 90, 340);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.28;

    const sky = new THREE.Mesh(
      new THREE.SphereGeometry(800, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: { top: { value: new THREE.Color(0x2a6cc4) }, horizon: { value: new THREE.Color(0xbfdcf3) } },
        vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
        fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vDir;
          void main(){ float h = clamp(vDir.y * 1.6 + 0.35, 0.0, 1.0); gl_FragColor = vec4(mix(horizon, top, pow(h, 0.8)), 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          }`,
      }),
    );
    sky.frustumCulled = false;
    scene.add(sky);

    scene.add(new THREE.HemisphereLight(0xcfe4ff, 0x5f6e48, 0.7));
    const sun = (this.sun = new THREE.DirectionalLight(0xffecc8, 2.0));
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -28; sc.right = 28; sc.top = 28; sc.bottom = -28; sc.near = 5; sc.far = 120;
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.04;
    scene.add(sun, sun.target);

    const turfTex = canvasTex((ctx, s) => {
      ctx.fillStyle = '#6fae3f'; ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 2600; i++) {
        ctx.strokeStyle = Math.random() < 0.5 ? 'rgba(150,210,90,0.55)' : 'rgba(60,120,40,0.5)';
        const x = Math.random() * s, y = Math.random() * s;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.random() * 3 - 1.5, y - 3 - Math.random() * 5); ctx.stroke();
      }
    });
    const rotTex = canvasTex((ctx, s) => { // rotten planks that give way
      for (let i = 0; i < 6; i++) {
        ctx.fillStyle = `hsl(28,${20 + Math.random() * 10}%,${18 + Math.random() * 8}%)`;
        ctx.fillRect(0, (i * s) / 6, s, s / 6);
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(0, (i * s) / 6, s, 3);
      }
      for (let i = 0; i < 26; i++) {
        ctx.strokeStyle = 'rgba(10,6,2,0.7)'; ctx.lineWidth = 2;
        ctx.beginPath(); const x = Math.random() * s, y = Math.random() * s;
        ctx.moveTo(x, y); ctx.lineTo(x + Math.random() * 40 - 20, y + Math.random() * 12 - 6); ctx.stroke();
      }
      for (let i = 0; i < 10; i++) { ctx.fillStyle = 'rgba(70,90,40,0.35)'; ctx.beginPath(); ctx.arc(Math.random() * s, Math.random() * s, 6 + Math.random() * 14, 0, Math.PI * 2); ctx.fill(); }
    });
    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, ...o });
    const side = std({ map: tex.wood, color: 0x8a6a48 });
    this.mats = {
      turf: [side, side, std({ map: turfTex }), std({ map: tex.wood, color: 0x6e5238 }), side, side],
      crate: std({ map: tex.crate }),
      sandbag: std({ map: tex.sandbag, roughness: 1 }),
      wood: std({ map: tex.wood }),
      tank: std({ map: tex.steel, roughness: 0.3, metalness: 0.7 }),
      rotten: std({ map: rotTex, roughness: 0.95 }),
      toxic: std({ color: 0x86e05a, emissive: 0x3c9a1e, emissiveIntensity: 0.9, roughness: 0.25 }),
      hazard: std({ color: 0xe8b521, roughness: 0.45 }),
      ice: std({ color: 0xbfe3f2, roughness: 0.04, metalness: 0.05, emissive: 0x1a3a4a, emissiveIntensity: 0.35 }),
      pad: std({ color: 0xff8a1e, emissive: 0xa04008, emissiveIntensity: 0.45, roughness: 0.4 }),
      padRim: std({ color: 0xffffff, roughness: 0.3 }),
      pole: std({ color: 0xe8e2d4, roughness: 0.5 }),
      flag: std({ map: tex.camo, side: THREE.DoubleSide }),
      flagOn: std({ color: 0xf2c14e, emissive: 0xb57d12, emissiveIntensity: 0.6, side: THREE.DoubleSide }),
      gold: std({ color: 0xf2c14e, roughness: 0.2, metalness: 1, emissive: 0x6b4a08, emissiveIntensity: 0.4 }),
      start: std({ color: 0x5d9cec, emissive: 0x1d4c8c, emissiveIntensity: 0.6, roughness: 0.35 }),
      paint: new THREE.MeshStandardMaterial({ map: tex.concrete, color: 0xd9d6cf, roughness: 0.8 }),
    };
    this.unitBox = new THREE.BoxGeometry(1, 1, 1);

    const sea = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ color: 0x1f3440, roughness: 0.12, metalness: 0.4 }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = KILL_Y - 1.5;
    sea.receiveShadow = true;
    scene.add(sea);

    this.decor = [];
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xf3f6fa, roughness: 1 });
    for (let i = 0; i < 30; i++) {
      const c = new THREE.Group();
      for (let k = 0; k < 4; k++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(3 + Math.random() * 3, 10, 8), cloudMat);
        s.position.set(k * 4 - 6, Math.random() * 1.5, Math.random() * 3);
        s.scale.y = 0.55;
        c.add(s);
      }
      const sgn = Math.random() < 0.5 ? -1 : 1;
      c.position.set(sgn * (25 + Math.random() * 60), BASE + 5 + Math.random() * 30, 40 - Math.random() * 320);
      scene.add(c);
      this.decor.push({ obj: c, drift: 0.3 + Math.random() * 0.6 });
    }
    for (let i = 0; i < 16; i++) {
      const b = new THREE.Mesh(
        new THREE.CylinderGeometry(0.9, 0.9, 2.6, 20),
        new THREE.MeshStandardMaterial({ map: tex.metal, color: i % 3 ? 0xb5402a : 0x2f5a9a, roughness: 0.55, metalness: 0.5 }),
      );
      const sgn = i % 2 ? -1 : 1;
      b.position.set(sgn * (9 + Math.random() * 10), KILL_Y + 1 + Math.random() * 6, 10 - i * 16);
      b.rotation.z = (Math.random() - 0.5) * 0.8;
      scene.add(b);
      this.decor.push({ obj: b, bob: Math.random() * 6, baseY: b.position.y });
    }

    this.player = new SoldierModel('T');
    this.player.setWeapon('knife');
    scene.add(this.player.root);
  }

  // ─── Course loading ──────────────────────────────────────────
  loadCourse(def) {
    const key = def ? `custom:${def.code || 'draft'}:${def.rev || 0}` : 'official';
    if (this.courseKey === key && this.root) return;
    if (this.root) this.scene.remove(this.root);
    this.root = new THREE.Group();
    this.scene.add(this.root);
    this.boxes = [];
    this.movers = [];
    this.vanishers = [];
    this.kills = [];
    this.pads = [];
    this.spinners = [];
    this.bumpers = [];
    this.checkpoints = [];
    this.statues = [];
    this.cellTypes = null;
    this.cellHash = null;
    this.finishKeys = null;
    this.bell = null;
    this.custom = !!def;
    this.def = def;
    if (def) this.makeCustomCourse(def);
    else this.makeCourse();
    this.computePath();
    this.courseKey = key;
  }

  add(obj) {
    this.root.add(obj);
    return obj;
  }

  /** Solid platform with its top surface at `top`. */
  plat(x, top, z, w, d, mat, { h = 1, tile = 2, register = true } = {}) {
    const mesh = new THREE.Mesh(tiledBox(w, h, d, tile), mat);
    mesh.position.set(x, top - h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.add(mesh);
    const box = { min: [x - w / 2, top - h, z - d / 2], max: [x + w / 2, top, z + d / 2] };
    if (register) this.boxes.push(box);
    return { mesh, box, w, h, d };
  }

  makeFlag(x, top, z) {
    const flag = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3, 8), this.mats.pole);
    pole.position.y = 1.5;
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.85, 8, 4), this.mats.flag);
    cloth.position.set(0.68, 2.5, 0);
    flag.add(pole, cloth);
    flag.position.set(x, top, z);
    flag.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.add(flag);
    return cloth;
  }

  checkpoint(x, top, z, w = 6, d = 6) {
    const p = this.plat(x, top, z, w, d, this.mats.turf);
    const cloth = this.makeFlag(x + w / 2 - 0.6, top, z - d / 2 + 0.6);
    this.checkpoints.push({ index: this.checkpoints.length, spawn: [x, top, z], zone: p.box, cloth, reached: false });
    return p;
  }

  makeCourse() {
    const M = this.mats;
    this.checkpoint(0, BASE, 0, 10, 10);
    this.checkpoints[0].reached = true;
    this.start = [0, BASE, 2];

    // 1 · Pasture Hop
    [[0, BASE, -8], [1.6, BASE + 0.5, -12.5], [-1.6, BASE + 1, -17], [0.6, BASE + 1, -21.5]].forEach(([x, t, z]) => this.plat(x, t, z, 2.2, 2.2, M.crate, { h: 2.2, tile: 2.2 }));
    this.checkpoint(0, BASE + 1, -27);

    // 2 · Churn Spinners
    this.plat(0, BASE + 1, -42, 2.4, 24, M.wood, { h: 0.6 });
    [[-36, 1.5], [-42, -2.0], [-48, 2.5]].forEach(([z, speed], i) => this.spinner((i % 2 ? -1 : 1) * 3.2, BASE + 1, z, 5.3, speed));
    this.checkpoint(0, BASE + 1, -58);

    // 3 · Tank Express
    this.mover(3, 3, [-4, BASE + 1, -63.5], [4, BASE + 1, -63.5], 4.0, M.tank);
    this.mover(3, 3, [4, BASE + 1, -69], [-4, BASE + 1, -69], 3.4, M.tank);
    this.mover(3, 3, [0, BASE + 1, -74.5], [0, BASE + 3.5, -74.5], 3.0, M.tank);
    this.plat(0, BASE + 3.5, -80, 3, 3, M.wood, { h: 0.8 });
    this.mover(3, 3, [0, BASE + 3.5, -85.5], [0, BASE + 3.5, -90.5], 3.6, M.tank);
    this.checkpoint(0, BASE + 3.5, -97);

    // 4 · Rotten Planks
    const layout = [['c', 's', 'c'], ['s', 'c', 'c'], ['c', 'c', 's'], ['c', 's', 'c'], ['s', 'c', 's']];
    layout.forEach((row, r) => row.forEach((kind, col) => {
      const x = (col - 1) * 2.6, z = -103.5 - r * 2.6;
      if (kind === 'c') {
        const p = this.plat(x, BASE + 3.5, z, 2.2, 2.2, M.rotten.clone(), { h: 0.6, tile: 2.2 });
        p.mesh.material.transparent = true;
        this.vanishers.push({ ...p, home: p.mesh.position.clone(), state: 'solid', t: 0 });
      } else {
        this.kills.push(this.plat(x, BASE + 3.35, z, 2.2, 2.2, M.toxic, { h: 0.45 }));
      }
    }));
    this.checkpoint(0, BASE + 3.5, -120);

    // 5 · Sandbag Bounce
    this.pad(0, BASE + 3.5, -127, 16);
    this.plat(0, BASE + 8, -133, 4, 4, M.sandbag, { h: 1.2 });
    this.pad(0, BASE + 8, -138.5, 16);
    this.plat(0, BASE + 12.5, -145, 4, 4, M.sandbag, { h: 1.2 });
    this.checkpoint(0, BASE + 12.5, -152);

    // 6 · Watchtower — 12 spiral steps up to the tower top
    const cx = 0, cz = -163;
    const bottle = new THREE.Mesh(
      new THREE.LatheGeometry([[0, 0], [3.8, 0], [3.8, 21.8], [4.2, 21.8], [4.2, 23.2], [0, 23.2]].map(([r, y]) => new THREE.Vector2(r, y)), 32),
      M.paint,
    );
    bottle.position.set(cx, BASE + 1.5, cz);
    bottle.castShadow = true;
    this.add(bottle);
    const label = new THREE.Mesh(new THREE.CylinderGeometry(3.85, 3.85, 4, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.6, side: THREE.DoubleSide }));
    label.position.set(cx, BASE + 9, cz);
    this.add(label);
    for (let i = 0; i < 12; i++) {
      const a = i * 0.63;
      this.plat(cx + Math.sin(a) * 5.2, BASE + 13.4 + i * 0.9, cz + Math.cos(a) * 5.2, 2, 2, i % 2 ? M.sandbag : M.crate, { h: 0.7, tile: 2 });
    }
    const T = BASE + 23.3;
    this.checkpoint(cx, T, cz, 5, 5);

    // 7 · Rafters — narrow beams, a sliding beam and a rotor sweeper
    this.plat(0, T, -170, 1.2, 6, M.wood, { h: 0.5 });
    this.plat(1.8, T, -177, 1.2, 5, M.wood, { h: 0.5 });
    this.mover(1.8, 5, [-2.5, T, -184.5], [2.5, T, -184.5], 3.2, M.wood);
    this.plat(-1.5, T + 0.6, -192, 1.2, 6, M.wood, { h: 0.5 });
    this.spinner(2.2, T + 0.6, -192, 4.2, 1.8);
    const R = T + 0.6;
    this.checkpoint(0, R, -200, 5, 5);

    // 8 · Barrel Run — rolling barrels across a gappy runway
    this.plat(0, R, -209.5, 6, 9, M.wood, { h: 0.6 });
    this.plat(0, R, -220.5, 6, 9, M.wood, { h: 0.6 });
    this.plat(0, R, -231.5, 6, 9, M.wood, { h: 0.6 });
    [[-208.5, 2.4, 0], [-212, 2.0, 1.1], [-219, 2.6, 0.4], [-222.5, 2.2, 1.6], [-230, 2.0, 0.8], [-233.5, 2.5, 1.9]]
      .forEach(([z, period, phase]) => this.bumper(z, R, period, phase));

    const F = R + 0.6;
    const finish = this.plat(0, F, -242, 6, 6, M.gold, { h: 0.6 });
    this.finishZone = { min: [finish.box.min[0], F, finish.box.min[2]], max: [finish.box.max[0], F + 3, finish.box.max[2]] };
    this.bell = this.makeBell();
    this.bell.position.set(0, F + 1.6, -242);
    this.add(this.bell);
    this.finishPoint = [0, F, -242];

    // Soldier monuments on pillars
    [[-16, -40, 1], [16, -95, -1], [-18, -150, 1], [18, -215, -1]].forEach(([x, z, face], i) => {
      this.plat(x, BASE - 1, z, 6, 6, this.mats.turf, { h: 30, register: false });
      const statue = new SoldierModel(i % 2 ? 'CT' : 'T');
      statue.setWeapon('carbine');
      statue.root.scale.setScalar(3.2);
      statue.root.position.set(x, BASE - 1, z);
      statue.root.rotation.y = face > 0 ? -Math.PI / 2 : Math.PI / 2;
      this.add(statue.root);
      this.statues.push(statue);
    });
  }

  /** A player-made course: 1 m blocks on an integer grid. */
  makeCustomCourse(def) {
    this.cellTypes = new Map();
    this.cellHash = new Map();
    this.finishKeys = new Set();
    const byType = new Map();
    let start = null;
    const checks = [];
    for (const [x, y, z, t] of def.blocks) {
      const key = `${x},${y},${z}`;
      this.cellTypes.set(key, t);
      const box = { min: [x, BASE + y, z], max: [x + 1, BASE + y + 1, z + 1] };
      const col = `${x},${z}`;
      if (!this.cellHash.has(col)) this.cellHash.set(col, []);
      this.cellHash.get(col).push(box);
      if (t === BLOCK.ROTTEN) {
        const mesh = new THREE.Mesh(this.unitBox, this.mats.rotten.clone());
        mesh.material.transparent = true;
        mesh.position.set(x + 0.5, BASE + y + 0.5, z + 0.5);
        mesh.castShadow = mesh.receiveShadow = true;
        this.add(mesh);
        this.vanishers.push({ mesh, box, w: 1, h: 1, d: 1, home: mesh.position.clone(), state: 'solid', t: 0, key });
        continue;
      }
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t).push([x, y, z]);
      if (t === BLOCK.START) start = [x + 0.5, BASE + y + 1, z + 0.5];
      if (t === BLOCK.CHECK) checks.push({ key, x, y, z });
      if (t === BLOCK.FINISH) {
        this.finishKeys.add(key);
        if (!this.bell) {
          this.bell = this.makeBell();
          this.bell.position.set(x + 0.5, BASE + y + 2.6, z + 0.5);
          this.add(this.bell);
        }
      }
    }
    const m4 = new THREE.Matrix4();
    for (const [t, cells] of byType) {
      const mesh = new THREE.InstancedMesh(this.unitBox, this.blockMaterial(t), cells.length);
      cells.forEach(([x, y, z], i) => mesh.setMatrixAt(i, m4.makeTranslation(x + 0.5, BASE + y + 0.5, z + 0.5)));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.add(mesh);
    }
    this.start = start || [0.5, BASE + 1, 0.5];
    this.checkpoints.push({ index: 0, spawn: this.start, reached: true, cloth: null, key: null });
    for (const c of checks) {
      const cloth = this.makeFlag(c.x + 0.8, BASE + c.y + 1, c.z + 0.2);
      this.checkpoints.push({ index: this.checkpoints.length, spawn: [c.x + 0.5, BASE + c.y + 1, c.z + 0.5], reached: false, cloth, key: c.key });
    }
  }

  blockMaterial(t) {
    const M = this.mats;
    return [M.turf, M.crate, M.sandbag, M.wood, M.tank, M.rotten, M.toxic, M.pad, M.ice, M.turf, M.start, M.gold][t] || M.crate;
  }

  spinner(px, top, z, length, speed) {
    const group = new THREE.Group();
    group.position.set(px, top + 0.9, z);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, length, 12), this.mats.hazard);
    bar.rotation.z = Math.PI / 2;
    bar.position.x = length / 2;
    bar.castShadow = true;
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10), this.mats.pad);
    tip.position.x = length;
    group.add(bar, tip);
    this.add(group);
    const churn = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 6, 16), this.mats.wood);
    churn.position.set(px, top - 2.1, z);
    churn.castShadow = true;
    this.add(churn);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), this.mats.hazard);
    cap.position.set(px, top + 0.9, z);
    this.add(cap);
    this.spinners.push({ group, px, y: top + 0.9, z, length, speed, angle: Math.random() * 6 });
  }

  mover(w, d, a, b, period, mat) {
    const p = this.plat(a[0], a[1], a[2], w, d, mat, { h: 0.8 });
    this.movers.push({ ...p, a, b, period, phase: Math.random() * period });
  }

  pad(x, top, z, power) {
    const p = this.plat(x, top, z, 3, 3, this.mats.sandbag, { h: 1.2 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.12, 8, 24), this.mats.padRim);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(x, top + 0.12, z);
    const tramp = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.1, 24), this.mats.pad);
    tramp.position.set(x, top + 0.08, z);
    this.add(rim);
    this.add(tramp);
    this.pads.push({ ...p, power, tramp });
  }

  bumper(z, top, period, phase) {
    const group = new THREE.Group();
    const bale = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 0.8, 1.6, 20), new THREE.MeshStandardMaterial({ map: this.tex.metal, color: 0x6b7a3a, roughness: 0.6, metalness: 0.5 }));
    bale.rotation.x = Math.PI / 2;
    bale.castShadow = true;
    for (const off of [-0.45, 0.45]) {
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.815, 0.815, 0.08, 20), this.mats.wood);
      band.position.y = off;
      bale.add(band);
    }
    group.add(bale);
    group.position.set(0, top + 0.8, z);
    this.add(group);
    this.bumpers.push({ group, bale, z, top, period, phase, x: 0, vx: 0 });
  }

  makeBell() {
    const g = new THREE.Group();
    const bell = new THREE.Mesh(
      new THREE.LatheGeometry([[0, 1.3], [0.35, 1.25], [0.6, 1.0], [0.75, 0.4], [1.05, 0], [0.95, -0.06], [0, -0.06]].map(([r, y]) => new THREE.Vector2(r, y)), 32),
      this.mats.gold,
    );
    bell.position.y = -0.6;
    const loop = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.07, 8, 16), this.mats.gold);
    loop.position.y = 0.85;
    const clapper = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), this.mats.gold);
    clapper.position.y = -0.62;
    g.add(bell, loop, clapper);
    g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    return g;
  }

  /** Path along checkpoints → finish, used for the distance leaderboard. */
  computePath() {
    if (this.custom) { this.path = null; return; }
    const pts = [...this.checkpoints.map((c) => c.spawn), this.finishPoint];
    const cum = [0];
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1], pts[i]];
      cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
    }
    this.path = { pts, cum, total: cum[cum.length - 1] };
  }

  // ─── Run lifecycle ───────────────────────────────────────────
  start(def = null, { fromEditor = false } = {}) {
    this.ensureBase();
    this.loadCourse(def);
    this.root.visible = true;
    this.fromEditor = fromEditor;
    this.active = true;
    this.game.renderer.shadowMap.autoUpdate = true;
    this.game.camera.fov = this.game.settings.fov;
    this.game.camera.updateProjectionMatrix();
    this.el.hud.hidden = false;
    this.el.menuBtn.textContent = fromEditor ? 'Back to editor' : 'Main menu';
    this.el.help.innerHTML = `<kbd>W A S D</kbd> move · <kbd>Space</kbd> jump · <kbd>E</kbd> dash · <kbd>R</kbd> last checkpoint${fromEditor ? ' · <kbd>T</kbd> back to editor' : ''} · <kbd>Esc</kbd> pause`;
    if (def?.code && !fromEditor) postJSON(`/api/obbies/${def.code}/play`, {});
    this.restart();
  }

  stop() {
    if (this.active) this.submitDistance(false);
    this.active = false;
    this.el.hud.hidden = true;
    this.el.finish.hidden = true;
    this.game.renderer.shadowMap.autoUpdate = false;
    this.game.renderer.shadowMap.needsUpdate = true;
  }

  bestKey() {
    return this.custom ? `${BEST_KEY}.${this.def?.code || 'draft'}` : BEST_KEY;
  }

  restart() {
    this.time = 0;
    this.running = false;
    this.finished = false;
    this.deaths = 0;
    this.clock = 0;
    this.checkpointIndex = 0;
    this.reachedCount = 0;
    this.runDistance = 0;
    this.submittedDistance = Number(localStorage.getItem(BEST_DIST_KEY)) || 0;
    this.goneKeys = new Set();
    this.onIce = false;
    for (const c of this.checkpoints) {
      c.reached = c.index === 0;
      if (c.cloth) c.cloth.material = c.reached ? this.mats.flagOn : this.mats.flag;
    }
    for (const v of this.vanishers) this.resetVanisher(v);
    this.el.finish.hidden = true;
    this.best = Number(localStorage.getItem(this.bestKey())) || 0;
    this.spawnAt(this.start, 0);
    this.game.yaw = 0;
    this.game.pitch = -0.25;
    this.toast('GO!', false);
  }

  spawnAt(pos, yaw = null) {
    this.body = newBody(pos[0], pos[1] + 0.05, pos[2]);
    this.lastGroundT = 0;
    this.facing = yaw ?? this.facing ?? 0;
    this.knockUntil = 0;
    this.dashUntil = 0;
    this.dashReadyAt = 0;
    this.airDashUsed = false;
  }

  respawn(manual = false) {
    if (this.finished) return;
    const cp = this.checkpoints[this.checkpointIndex];
    this.deaths++;
    this.el.fade.style.opacity = '0.85';
    setTimeout(() => { this.el.fade.style.opacity = '0'; }, 180);
    this.spawnAt([cp.spawn[0], cp.spawn[1], cp.spawn[2]]);
    this.game.audio.splash();
    if (!manual) this.toast('SPLASH!', true);
    this.submitDistance(false);
  }

  resetVanisher(v) {
    v.state = 'solid';
    v.t = 0;
    v.mesh.visible = true;
    v.mesh.material.opacity = 1;
    v.mesh.position.copy(v.home);
    v.box.min = [v.home.x - v.w / 2, v.home.y - v.h / 2, v.home.z - v.d / 2];
    v.box.max = [v.home.x + v.w / 2, v.home.y + v.h / 2, v.home.z + v.d / 2];
    if (v.key) this.goneKeys?.delete(v.key);
  }

  toast(text, bad) {
    const el = this.el.toast;
    el.textContent = text;
    el.classList.toggle('bad', !!bad);
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  submitDistance(finished) {
    if (this.custom || !this.path) return;
    const distance = finished ? this.path.total : this.runDistance;
    if (!finished && distance < this.submittedDistance + 0.5) return;
    this.submittedDistance = Math.max(this.submittedDistance, distance);
    try { localStorage.setItem(BEST_DIST_KEY, String(this.submittedDistance)); } catch { /* storage unavailable */ }
    postJSON('/api/obby/run', { name: playerName(), distance: Math.round(distance * 10) / 10, finished, time: finished ? this.time : null });
  }

  // ─── Simulation ──────────────────────────────────────────────
  standingOn(box) {
    const b = this.body;
    const r = PLAYER.RADIUS * 0.9;
    return b.onGround && Math.abs(b.y - box.max[1]) < 0.09
      && b.x > box.min[0] - r && b.x < box.max[0] + r && b.z > box.min[2] - r && b.z < box.max[2] + r;
  }

  nearbyBoxes() {
    const out = (this.near ??= []);
    out.length = 0;
    const cx = Math.floor(this.body.x), cz = Math.floor(this.body.z);
    for (let dx = -3; dx <= 3; dx++) {
      for (let dz = -3; dz <= 3; dz++) {
        const list = this.cellHash.get(`${cx + dx},${cz + dz}`);
        if (list) for (const box of list) out.push(box);
      }
    }
    return out;
  }

  /** Block types directly under the cow's feet in a custom course. */
  underfoot() {
    const b = this.body;
    if (!b.onGround) return [];
    const rel = b.y - BASE;
    const top = Math.round(rel);
    if (Math.abs(rel - top) > 0.08) return [];
    const y = top - 1;
    const found = new Map();
    for (const [ox, oz] of [[0, 0], [-0.3, -0.3], [0.3, -0.3], [-0.3, 0.3], [0.3, 0.3]]) {
      const key = `${Math.floor(b.x + ox)},${y},${Math.floor(b.z + oz)}`;
      const t = this.cellTypes.get(key);
      if (t !== undefined && !this.goneKeys.has(key)) found.set(key, t);
    }
    return [...found];
  }

  reachCheckpoint(cp) {
    const fresh = !cp.reached;
    cp.reached = true;
    if (this.custom) this.checkpointIndex = cp.index;
    else if (cp.index > this.checkpointIndex) this.checkpointIndex = cp.index;
    if (!fresh) return;
    if (cp.cloth) cp.cloth.material = this.mats.flagOn;
    this.toast('CHECKPOINT!', false);
    this.game.audio.killConfirm(2);
    this.submitDistance(false);
  }

  startVanish(v) {
    if (v.state !== 'solid') return;
    v.state = 'shaking';
    v.t = 0;
    this.game.audio.blockBreak(null);
  }

  update(dt) {
    if (!this.active) return;
    const game = this.game;
    const now = performance.now() / 1000;
    this.clock += dt;
    const b = this.body;

    for (const m of this.movers) {
      const wasOn = this.standingOn(m.box);
      const k = (1 - Math.cos(((this.clock + m.phase) / m.period) * Math.PI * 2)) / 2;
      const x = m.a[0] + (m.b[0] - m.a[0]) * k, top = m.a[1] + (m.b[1] - m.a[1]) * k, z = m.a[2] + (m.b[2] - m.a[2]) * k;
      const dx = x - (m.box.min[0] + m.w / 2), dy = top - m.box.max[1], dz = z - (m.box.min[2] + m.d / 2);
      m.box.min = [x - m.w / 2, top - m.h, z - m.d / 2];
      m.box.max = [x + m.w / 2, top, z + m.d / 2];
      m.mesh.position.set(x, top - m.h / 2, z);
      if (wasOn) { b.x += dx; b.y += dy; b.z += dz; }
    }

    for (const v of this.vanishers) {
      if (!this.custom && v.state === 'solid' && this.standingOn(v.box)) this.startVanish(v);
      if (v.state === 'shaking') {
        v.t += dt;
        v.mesh.position.set(v.home.x + (Math.random() - 0.5) * 0.08, v.home.y, v.home.z + (Math.random() - 0.5) * 0.08);
        if (v.t > 0.55) {
          v.state = 'gone';
          v.t = 0;
          v.box.min = [0, -1000, 0];
          v.box.max = [0, -999, 0];
          if (v.key) this.goneKeys.add(v.key);
        }
      } else if (v.state === 'gone') {
        v.t += dt;
        v.mesh.position.y -= dt * 6;
        v.mesh.material.opacity = Math.max(0, 1 - v.t * 1.5);
        if (v.t > 3) this.resetVanisher(v);
      }
    }

    if (!this.finished) {
      const k = game.keys;
      const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
      const str = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
      const yaw = game.yaw;
      let wx = -Math.sin(yaw) * fwd + Math.cos(yaw) * str;
      let wz = -Math.cos(yaw) * fwd - Math.sin(yaw) * str;
      const l = Math.hypot(wx, wz);
      if (l > 0) { wx /= l; wz /= l; }
      if (b.onGround) this.lastGroundT = now;
      if (b.onGround && now > this.dashUntil) this.airDashUsed = false;
      const wantJump = performance.now() - game.jumpQueued < 140;
      if (wantJump && !b.onGround && now - this.lastGroundT < 0.12 && b.vy <= 0.5) {
        b.vy = PLAYER.JUMP_V;
        game.jumpQueued = 0;
        this.lastGroundT = 0;
      }
      const knocked = now < this.knockUntil;
      const dashing = now < this.dashUntil;
      stepBody(b, {
        wx: knocked || dashing ? 0 : wx, wz: knocked || dashing ? 0 : wz, jump: wantJump && b.onGround && !dashing,
        walk: k.has('ShiftLeft'), crouch: false, speedMult: 1.05, airControl: !dashing,
        slick: dashing || this.onIce, noCap: dashing,
      }, dt, this.custom ? this.nearbyBoxes() : this.boxes);
      if (b.jumped) { b.jumped = false; game.jumpQueued = 0; }
      if (b.landedSpeed > 9) game.audio.land(null);
      if (l > 0 && !knocked && !dashing) this.facing = Math.atan2(-wx, -wz);
      if (!this.running && (l > 0 || !b.onGround)) this.running = true;
      if (this.running) this.time += dt;
    }

    for (const s of this.spinners) {
      s.angle += s.speed * dt;
      s.group.rotation.y = s.angle;
      const rx = b.x - s.px, rz = b.z - s.z;
      const c = Math.cos(s.angle), sn = Math.sin(s.angle);
      const along = rx * c - rz * sn;
      const across = rx * sn + rz * c;
      if (along > 0 && along < s.length + 0.3 && Math.abs(across) < 0.62 && b.y < s.y + 0.35 && b.y + 1.8 > s.y - 0.35 && now > this.knockUntil) {
        const dir = Math.sign(s.speed);
        b.vx = -sn * dir * 11;
        b.vz = -c * dir * 11;
        b.vy = 5.5;
        b.onGround = false;
        this.knockUntil = now + 0.45;
        game.audio.hurt();
      }
    }

    for (const bm of this.bumpers) {
      const k = (1 - Math.cos(((this.clock + bm.phase) / bm.period) * Math.PI * 2)) / 2;
      const x = -2.2 + 4.4 * k;
      bm.vx = (x - bm.x) / Math.max(dt, 1e-4);
      bm.bale.rotation.y -= (x - bm.x) / 0.8;
      bm.x = x;
      bm.group.position.x = x;
      if (Math.abs(b.x - x) < 1.2 && Math.abs(b.z - bm.z) < 1.2 && b.y < bm.top + 1.6 && b.y + 1.8 > bm.top && now > this.knockUntil) {
        b.vx = Math.sign(bm.vx || (b.x - x)) * 10;
        b.vz = (b.z - bm.z) * 2;
        b.vy = 5;
        b.onGround = false;
        this.knockUntil = now + 0.4;
        game.audio.hurt();
      }
    }

    if (this.custom) {
      this.onIce = false;
      for (const [key, t] of this.underfoot()) {
        if (t === BLOCK.TOXIC) { this.respawn(); break; }
        if (t === BLOCK.PAD) { b.vy = 15; b.onGround = false; game.audio.stomp(null); }
        if (t === BLOCK.ICE) this.onIce = true;
        if (t === BLOCK.ROTTEN) { const v = this.vanishers.find((x) => x.key === key); if (v) this.startVanish(v); }
        if (t === BLOCK.CHECK) { const cp = this.checkpoints.find((c) => c.key === key); if (cp) this.reachCheckpoint(cp); }
        if (t === BLOCK.FINISH && !this.finished) this.finish();
      }
    } else {
      for (const p of this.pads) {
        p.tramp.scale.y = 1 + Math.sin(this.clock * 6) * 0.3;
        if (this.standingOn(p.box)) {
          b.vy = p.power;
          b.onGround = false;
          game.audio.stomp(null);
          p.tramp.scale.y = 3;
        }
      }
      for (const kt of this.kills) {
        kt.mesh.scale.y = 1 + Math.sin(this.clock * 4 + kt.box.min[0]) * 0.08;
        if (this.standingOn(kt.box)) { this.respawn(); break; }
      }
      for (const cp of this.checkpoints) if (!cp.reached && this.standingOn(cp.zone)) this.reachCheckpoint(cp);
      const fz = this.finishZone;
      if (!this.finished && b.x > fz.min[0] && b.x < fz.max[0] && b.z > fz.min[2] && b.z < fz.max[2] && b.y >= fz.min[1] - 0.05 && b.y < fz.max[1]) this.finish();
      // furthest distance along the course
      const { pts, cum } = this.path;
      const i = Math.min(this.checkpointIndex, pts.length - 2);
      const A = pts[i], B = pts[i + 1];
      const sx = B[0] - A[0], sy = B[1] - A[1], sz = B[2] - A[2];
      const len2 = sx * sx + sy * sy + sz * sz || 1;
      const proj = Math.min(1, Math.max(0, ((b.x - A[0]) * sx + (b.y - A[1]) * sy + (b.z - A[2]) * sz) / len2));
      this.runDistance = Math.max(this.runDistance, cum[i] + proj * Math.sqrt(len2));
    }
    if (b.y < KILL_Y) this.respawn();

    const speed = Math.hypot(b.vx, b.vz);
    this.player.root.position.set(b.x, b.y, b.z);
    const cur = this.player.root.rotation.y;
    let diff = this.facing - cur;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.player.root.rotation.y = cur + diff * Math.min(1, dt * 12);
    this.player.update(dt, { speed, crouch: 0, pitch: 0, onGround: b.onGround });
    const diveK = now < this.dashUntil ? 1 : Math.max(0, 1 - (now - this.dashUntil) / 0.25);
    this.player.pose.rotation.x = -1.05 * diveK;
    this.player.pose.position.y = 0.4 * diveK;
    if (now < this.dashUntil) this.spawnPuff(b.x, b.y + 0.4, b.z);
    this.updatePuffs(dt);
    for (const s of this.statues) s.update(dt, { speed: 0, crouch: 0, pitch: Math.sin(this.clock) * 0.2, onGround: true });

    if (this.bell) {
      this.bell.rotation.y += dt * 1.2;
      this.bell.position.y += Math.sin(this.clock * 2) * 0.004;
    }
    for (const d of this.decor) {
      if (d.drift) d.obj.position.x += Math.sin(this.clock * 0.05 + d.drift) * d.drift * dt;
      if (d.baseY != null) d.obj.position.y = d.baseY + Math.sin(this.clock * 0.8 + d.bob) * 0.6;
    }

    const cam = game.camera;
    if (cam.fov !== game.settings.fov) { cam.fov = game.settings.fov; cam.updateProjectionMatrix(); }
    const elev = Math.min(1.15, Math.max(-0.3, -game.pitch + 0.15));
    const dist = 6.5;
    const head = new THREE.Vector3(b.x, b.y + 1.7, b.z);
    cam.position.set(head.x + Math.sin(game.yaw) * Math.cos(elev) * dist, head.y + Math.sin(elev) * dist, head.z + Math.cos(game.yaw) * Math.cos(elev) * dist);
    cam.lookAt(head);
    game.audio.setListener(b.x, b.y, b.z, game.yaw);
    this.sun.position.set(b.x + 25, b.y + 45, b.z + 18);
    this.sun.target.position.set(b.x, b.y, b.z);

    this.updateHud();
  }

  /** Stumble-Guys-style dive: E dashes forward, once per airtime (jump then dash works). */
  dash() {
    if (!this.active || this.finished || !this.body) return;
    const now = performance.now() / 1000;
    const b = this.body;
    if (now < this.dashReadyAt || now < this.knockUntil || this.airDashUsed) return;
    const k = this.game.keys;
    const yaw = this.game.yaw;
    const fwd = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    const str = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    let dx = -Math.sin(yaw) * fwd + Math.cos(yaw) * str;
    let dz = -Math.cos(yaw) * fwd - Math.sin(yaw) * str;
    if (!dx && !dz) { dx = -Math.sin(this.facing); dz = -Math.cos(this.facing); }
    const l = Math.hypot(dx, dz) || 1;
    dx /= l; dz /= l;
    b.vx = dx * 13;
    b.vz = dz * 13;
    b.vy = b.onGround ? 3.4 : Math.max(b.vy, 2.8);
    b.onGround = false;
    this.airDashUsed = true;
    this.facing = Math.atan2(-dx, -dz);
    this.dashUntil = now + 0.32;
    this.dashReadyAt = now + 0.8;
    this.running = true;
    this.game.audio.swing(null);
  }

  spawnPuff(x, y, z) {
    this.puffs ??= [];
    this.puffGeo ??= new THREE.SphereGeometry(0.22, 8, 6);
    if (this.puffs.length > 40) return;
    const m = new THREE.Mesh(this.puffGeo, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false }));
    m.position.set(x + (Math.random() - 0.5) * 0.4, y + (Math.random() - 0.5) * 0.3, z + (Math.random() - 0.5) * 0.4);
    this.scene.add(m);
    this.puffs.push({ m, life: 0.45 });
  }

  updatePuffs(dt) {
    if (!this.puffs?.length) return;
    this.puffs = this.puffs.filter((p) => {
      p.life -= dt;
      p.m.scale.setScalar(1 + (0.45 - p.life) * 3);
      p.m.material.opacity = Math.max(0, p.life / 0.45) * 0.7;
      if (p.life > 0) return true;
      this.scene.remove(p.m);
      p.m.material.dispose();
      return false;
    });
  }

  finish() {
    this.finished = true;
    this.running = false;
    const t = this.time;
    const prev = this.best;
    const isBest = !prev || t < prev;
    if (isBest) {
      try { localStorage.setItem(this.bestKey(), String(t)); } catch { /* storage unavailable */ }
      this.best = t;
    }
    if (this.custom) {
      if (this.def?.code && !this.fromEditor) postJSON(`/api/obbies/${this.def.code}/score`, { name: playerName(), time: t });
    } else {
      this.runDistance = this.path.total;
      this.submitDistance(true);
    }
    this.game.audio.jingle(true);
    this.el.finishTitle.textContent = this.custom ? `${this.def?.name || 'Course'} complete!` : 'Course complete!';
    this.el.finishTime.textContent = formatRunTime(t);
    const splashes = `${this.deaths} ${this.deaths === 1 ? 'splash' : 'splashes'}`;
    this.el.finishSub.textContent = `${splashes} · ${isBest ? (prev ? `New personal best! (was ${formatRunTime(prev)})` : 'Personal best set!') : `Personal best ${formatRunTime(prev)}`}`;
    this.el.finish.hidden = false;
    this.confetti();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  confetti() {
    const colors = ['#f2c14e', '#8fd16a', '#5d9cec', '#f29bb5', '#ffffff', '#1b1b1d'];
    for (let i = 0; i < 140; i++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.style.left = `${Math.random() * 100}vw`;
      c.style.background = colors[i % colors.length];
      c.style.animationDuration = `${2.2 + Math.random() * 2.5}s`;
      c.style.animationDelay = `${Math.random() * 0.6}s`;
      this.el.finish.appendChild(c);
      setTimeout(() => c.remove(), 5500);
    }
  }

  updateHud() {
    if (this.custom) {
      this.set('stage', `🧱 ${this.def?.name || 'Custom course'}${this.def?.author ? ` · by ${this.def.author}` : ''}`);
      const total = this.checkpoints.length - 1;
      const reached = this.checkpoints.filter((c) => c.index > 0 && c.reached).length;
      this.set('check', `🚩 ${reached}/${total}`);
      this.el.progress.style.width = `${this.finished ? 100 : total ? (reached / (total + 1)) * 100 : 0}%`;
    } else {
      const idx = Math.min(STAGES.length - 1, this.checkpointIndex);
      this.set('stage', `Stage ${idx + 1} · ${STAGES[idx]} · ${Math.floor(this.runDistance)} m`);
      this.set('check', `🚩 ${this.checkpointIndex}/${this.checkpoints.length - 1}`);
      this.el.progress.style.width = `${((this.finished ? 1 : this.runDistance / this.path.total) * 100).toFixed(1)}%`;
    }
    this.set('timer', formatRunTime(this.time));
    this.set('deaths', `💦 ${this.deaths}`);
    this.set('best', `🏆 ${this.best ? formatRunTime(this.best) : '—'}`);
    const dashReady = performance.now() / 1000 >= (this.dashReadyAt || 0) && !this.airDashUsed;
    this.set('dash', dashReady ? '⚡ DASH' : '⚡ …');
    this.el.dash.classList.toggle('ready', dashReady);
  }

  set(key, value) {
    this.cache ??= {};
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    this.el[key].textContent = value;
  }
}
