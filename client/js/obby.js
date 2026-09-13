// Udder Chaos Obby — a solo, client-only cow-themed obstacle course in the sky.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { newBody, stepBody } from '/shared/physics.js';
import { PLAYER } from '/shared/constants.js';
import { makeTextures } from './textures.js';
import { CowModel } from './cow.js';

const BASE = 20;
const KILL_Y = BASE - 9;
const STAGES = ['Pasture Hop', 'Churn Spinners', 'Milk Tank Express', 'Cheese Collapse', 'Hay Bounce', 'Udder Tower'];
const BEST_KEY = 'csmoo.obbyBest';

export function formatRunTime(s) {
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  return `${m}:${sec.toFixed(2).padStart(5, '0')}`;
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
    this.built = false;
    this.el = {
      hud: document.getElementById('obbyHud'),
      stage: document.getElementById('obStage'),
      timer: document.getElementById('obTimer'),
      deaths: document.getElementById('obDeaths'),
      check: document.getElementById('obCheck'),
      best: document.getElementById('obBest'),
      progress: document.getElementById('obProgress'),
      toast: document.getElementById('obToast'),
      fade: document.getElementById('obFade'),
      finish: document.getElementById('obFinish'),
      finishTime: document.getElementById('obfTime'),
      finishSub: document.getElementById('obfSub'),
    };
  }

  // ─── Course construction ─────────────────────────────────────
  build() {
    this.built = true;
    const scene = (this.scene = new THREE.Scene());
    const renderer = this.game.renderer;
    const tex = makeTextures();
    this.tex = tex;

    scene.background = new THREE.Color(0x6fa9e0);
    scene.fog = new THREE.Fog(0xa9cdee, 90, 340);
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.28;

    // Sky dome
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

    // Materials
    const turfTex = canvasTex((ctx, s) => {
      ctx.fillStyle = '#6fae3f'; ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 2600; i++) {
        ctx.strokeStyle = Math.random() < 0.5 ? 'rgba(150,210,90,0.55)' : 'rgba(60,120,40,0.5)';
        const x = Math.random() * s, y = Math.random() * s;
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.random() * 3 - 1.5, y - 3 - Math.random() * 5); ctx.stroke();
      }
    });
    const cheeseTex = canvasTex((ctx, s) => {
      ctx.fillStyle = '#f5c542'; ctx.fillRect(0, 0, s, s);
      for (let i = 0; i < 18; i++) {
        const x = Math.random() * s, y = Math.random() * s, r = 6 + Math.random() * 16;
        ctx.fillStyle = '#d9a324'; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#c28e18'; ctx.beginPath(); ctx.arc(x + 2, y + 2, r * 0.7, 0, Math.PI * 2); ctx.fill();
      }
    });
    const std = (o) => new THREE.MeshStandardMaterial({ roughness: 0.85, ...o });
    this.mats = {
      turf: [std({ map: tex.wood, color: 0x8a6a48 }), std({ map: tex.wood, color: 0x8a6a48 }), std({ map: turfTex }), std({ map: tex.wood, color: 0x6e5238 }), std({ map: tex.wood, color: 0x8a6a48 }), std({ map: tex.wood, color: 0x8a6a48 })],
      crate: std({ map: tex.crate }),
      hay: std({ map: tex.hay, roughness: 1 }),
      wood: std({ map: tex.wood }),
      tank: std({ map: tex.tank, roughness: 0.3, metalness: 0.6 }),
      cheese: std({ map: cheeseTex, roughness: 0.6 }),
      sour: std({ color: 0x86e05a, emissive: 0x3c9a1e, emissiveIntensity: 0.9, roughness: 0.25 }),
      butter: std({ color: 0xf7d96b, roughness: 0.45 }),
      pad: std({ color: 0xf29bb5, emissive: 0xb0406a, emissiveIntensity: 0.4, roughness: 0.4 }),
      padRim: std({ color: 0xffffff, roughness: 0.3 }),
      pole: std({ color: 0xe8e2d4, roughness: 0.5 }),
      flag: std({ map: tex.holstein, side: THREE.DoubleSide }),
      flagOn: std({ color: 0xf2c14e, emissive: 0xb57d12, emissiveIntensity: 0.6, side: THREE.DoubleSide }),
      gold: std({ color: 0xf2c14e, roughness: 0.2, metalness: 1, emissive: 0x6b4a08, emissiveIntensity: 0.4 }),
      milk: new THREE.MeshStandardMaterial({ color: 0xece8dc, roughness: 0.2, metalness: 0.05 }),
      glass: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.05, transparent: true, opacity: 0.35 }),
    };

    this.boxes = [];
    this.movers = [];
    this.vanishers = [];
    this.kills = [];
    this.pads = [];
    this.spinners = [];
    this.checkpoints = [];
    this.decor = [];

    this.makeCourse();
    this.makeScenery();
  }

  /** Solid platform with its top surface at `top`. */
  plat(x, top, z, w, d, mat, { h = 1, tile = 2, register = true } = {}) {
    const mesh = new THREE.Mesh(tiledBox(w, h, d, tile), mat);
    mesh.position.set(x, top - h / 2, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    const box = { min: [x - w / 2, top - h, z - d / 2], max: [x + w / 2, top, z + d / 2] };
    if (register) this.boxes.push(box);
    return { mesh, box, w, h, d };
  }

  checkpoint(x, top, z, w = 6, d = 6) {
    const p = this.plat(x, top, z, w, d, this.mats.turf);
    const flag = new THREE.Group();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 3, 8), this.mats.pole);
    pole.position.y = 1.5;
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.85, 8, 4), this.mats.flag);
    cloth.position.set(0.68, 2.5, 0);
    flag.add(pole, cloth);
    flag.position.set(x + w / 2 - 0.6, top, z - d / 2 + 0.6);
    flag.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(flag);
    const index = this.checkpoints.length;
    this.checkpoints.push({ index, spawn: [x, top, z], zone: p.box, cloth, reached: false });
    return p;
  }

  makeCourse() {
    const M = this.mats;
    // Start island
    this.checkpoint(0, BASE, 0, 10, 10);
    this.checkpoints[0].reached = true;
    this.start = [0, BASE, 2];

    // 1 · Pasture Hop — stepping crates that climb
    [[0, BASE, -8], [1.6, BASE + 0.5, -12.5], [-1.6, BASE + 1, -17], [0.6, BASE + 1, -21.5]].forEach(([x, t, z]) => this.plat(x, t, z, 2.2, 2.2, M.crate, { h: 2.2, tile: 2.2 }));
    this.checkpoint(0, BASE + 1, -27);

    // 2 · Churn Spinners — narrow bridge swept by butter churn bars
    this.plat(0, BASE + 1, -42, 2.4, 24, M.wood, { h: 0.6 });
    [[-36, 1.5], [-42, -2.0], [-48, 2.5]].forEach(([z, speed], i) => {
      const side = i % 2 ? -1 : 1;
      this.spinner(side * 3.2, BASE + 1, z, 5.3, speed);
    });
    this.checkpoint(0, BASE + 1, -58);

    // 3 · Milk Tank Express — moving platforms
    this.mover(3, 3, [-4, BASE + 1, -63.5], [4, BASE + 1, -63.5], 4.0, M.tank);
    this.mover(3, 3, [4, BASE + 1, -69], [-4, BASE + 1, -69], 3.4, M.tank);
    this.mover(3, 3, [0, BASE + 1, -74.5], [0, BASE + 3.5, -74.5], 3.0, M.tank);
    this.plat(0, BASE + 3.5, -80, 3, 3, M.wood, { h: 0.8 });
    this.mover(3, 3, [0, BASE + 3.5, -85.5], [0, BASE + 3.5, -90.5], 3.6, M.tank);
    this.checkpoint(0, BASE + 3.5, -97);

    // 4 · Cheese Collapse — cheese falls away, sour milk kills
    const layout = [
      ['c', 's', 'c'],
      ['s', 'c', 'c'],
      ['c', 'c', 's'],
      ['c', 's', 'c'],
      ['s', 'c', 's'],
    ];
    layout.forEach((row, r) => row.forEach((kind, col) => {
      const x = (col - 1) * 2.6, z = -103.5 - r * 2.6;
      if (kind === 'c') {
        const p = this.plat(x, BASE + 3.5, z, 2.2, 2.2, M.cheese.clone(), { h: 0.6, tile: 2.2 });
        p.mesh.material.transparent = true;
        this.vanishers.push({ ...p, home: p.mesh.position.clone(), state: 'solid', t: 0 });
      } else {
        const p = this.plat(x, BASE + 3.35, z, 2.2, 2.2, M.sour, { h: 0.45 });
        this.kills.push(p);
      }
    }));
    this.checkpoint(0, BASE + 3.5, -120);

    // 5 · Hay Bounce — launch pads up to higher tiers
    this.pad(0, BASE + 3.5, -127, 16);
    this.plat(0, BASE + 8, -133, 4, 4, M.hay, { h: 1.2 });
    this.pad(0, BASE + 8, -138.5, 16);
    this.plat(0, BASE + 12.5, -145, 4, 4, M.hay, { h: 1.2 });
    this.checkpoint(0, BASE + 12.5, -152);

    // 6 · Udder Tower — spiral around a giant milk bottle
    const cx = 0, cz = -163;
    const bottle = new THREE.Mesh(
      new THREE.LatheGeometry([[0, 0], [3.6, 0], [3.8, 0.4], [3.8, 16], [3.2, 18.5], [1.8, 20.5], [1.6, 22], [2.0, 22.4], [2.0, 23.2], [0, 23.2]].map(([r, y]) => new THREE.Vector2(r, y)), 32),
      M.milk,
    );
    bottle.position.set(cx, BASE + 1.5, cz);
    bottle.castShadow = true;
    this.scene.add(bottle);
    const label = new THREE.Mesh(new THREE.CylinderGeometry(3.85, 3.85, 4, 32, 1, true), new THREE.MeshStandardMaterial({ map: this.tex.holstein, side: THREE.DoubleSide }));
    label.position.set(cx, BASE + 9, cz);
    this.scene.add(label);
    for (let i = 0; i < 10; i++) {
      const a = i * 0.63;
      this.plat(cx + Math.sin(a) * 5.2, BASE + 13.4 + i * 0.9, cz + Math.cos(a) * 5.2, 2, 2, i % 2 ? M.hay : M.crate, { h: 0.7, tile: 2 });
    }
    const finishTop = BASE + 23.3;
    const finish = this.plat(cx, finishTop, cz, 5, 5, M.gold, { h: 0.6 });
    this.finishZone = { min: [finish.box.min[0], finishTop, finish.box.min[2]], max: [finish.box.max[0], finishTop + 3, finish.box.max[2]] };
    this.bell = this.makeBell();
    this.bell.position.set(cx, finishTop + 1.6, cz);
    this.scene.add(this.bell);
    this.finalZ = cz;
  }

  spinner(px, top, z, length, speed) {
    const group = new THREE.Group();
    group.position.set(px, top + 0.9, z);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, length, 12), this.mats.butter);
    bar.rotation.z = Math.PI / 2;
    bar.position.x = length / 2;
    bar.castShadow = true;
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.34, 14, 10), this.mats.pad);
    tip.position.x = length;
    group.add(bar, tip);
    this.scene.add(group);
    const churn = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 6, 16), this.mats.wood);
    churn.position.set(px, top - 2.1, z);
    churn.castShadow = true;
    this.scene.add(churn);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), this.mats.butter);
    cap.position.set(px, top + 0.9, z);
    this.scene.add(cap);
    this.spinners.push({ group, px, y: top + 0.9, z, length, speed, angle: Math.random() * 6 });
  }

  mover(w, d, a, b, period, mat) {
    const p = this.plat(a[0], a[1], a[2], w, d, mat, { h: 0.8 });
    this.movers.push({ ...p, a, b, period, phase: Math.random() * period });
  }

  pad(x, top, z, power) {
    const p = this.plat(x, top, z, 3, 3, this.mats.hay, { h: 1.2 });
    const rim = new THREE.Mesh(new THREE.TorusGeometry(1.05, 0.12, 8, 24), this.mats.padRim);
    rim.rotation.x = Math.PI / 2;
    rim.position.set(x, top + 0.12, z);
    const tramp = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.1, 24), this.mats.pad);
    tramp.position.set(x, top + 0.08, z);
    this.scene.add(rim, tramp);
    this.pads.push({ ...p, power, tramp });
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

  makeScenery() {
    // Milk sea
    const sea = new THREE.Mesh(new THREE.PlaneGeometry(900, 900, 1, 1), new THREE.MeshStandardMaterial({ color: 0xe4dccb, roughness: 0.35, metalness: 0.05 }));
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = KILL_Y - 1.5;
    sea.receiveShadow = true;
    this.scene.add(sea);
    this.sea = sea;

    // Clouds
    const cloudMat = new THREE.MeshStandardMaterial({ color: 0xf3f6fa, roughness: 1 });
    for (let i = 0; i < 26; i++) {
      const c = new THREE.Group();
      for (let k = 0; k < 4; k++) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(3 + Math.random() * 3, 10, 8), cloudMat);
        s.position.set(k * 4 - 6, Math.random() * 1.5, Math.random() * 3);
        s.scale.y = 0.55;
        c.add(s);
      }
      const side = Math.random() < 0.5 ? -1 : 1;
      c.position.set(side * (25 + Math.random() * 60), BASE + 5 + Math.random() * 30, 20 - Math.random() * 220);
      this.scene.add(c);
      this.decor.push({ obj: c, drift: 0.3 + Math.random() * 0.6 });
    }

    // Giant cow statues on pillars watching the course
    const statues = [[-16, -40, 1], [16, -95, -1], [-18, -150, 1]];
    this.statues = statues.map(([x, z, face], i) => {
      this.plat(x, BASE - 1, z, 6, 6, this.mats.turf, { h: 30, register: false });
      const cow = new CowModel(i % 2 ? 'CT' : 'T', this.tex);
      cow.setWeapon('hoof');
      cow.root.scale.setScalar(3.2);
      cow.root.position.set(x, BASE - 1, z);
      cow.root.rotation.y = face > 0 ? -Math.PI / 2 : Math.PI / 2;
      this.scene.add(cow.root);
      return cow;
    });

    // Floating milk bottles
    for (let i = 0; i < 12; i++) {
      const b = new THREE.Mesh(
        new THREE.LatheGeometry([[0, 0], [0.9, 0], [0.95, 0.1], [0.95, 2.2], [0.5, 2.9], [0.45, 3.3], [0, 3.3]].map(([r, y]) => new THREE.Vector2(r, y)), 20),
        this.mats.milk,
      );
      const side = i % 2 ? -1 : 1;
      b.position.set(side * (9 + Math.random() * 10), KILL_Y + 1 + Math.random() * 6, -10 - i * 15);
      b.rotation.z = (Math.random() - 0.5) * 0.8;
      this.scene.add(b);
      this.decor.push({ obj: b, bob: Math.random() * 6, baseY: b.position.y });
    }

    // Player cow
    this.cow = new CowModel('T', this.tex);
    this.cow.setWeapon('hoof');
    this.scene.add(this.cow.root);
  }

  // ─── Run lifecycle ───────────────────────────────────────────
  start() {
    if (!this.built) this.build();
    this.active = true;
    this.game.renderer.shadowMap.autoUpdate = true;
    this.game.camera.fov = this.game.settings.fov;
    this.game.camera.updateProjectionMatrix();
    this.el.hud.hidden = false;
    this.restart();
  }

  stop() {
    this.active = false;
    this.el.hud.hidden = true;
    this.el.finish.hidden = true;
    this.game.renderer.shadowMap.autoUpdate = false;
    this.game.renderer.shadowMap.needsUpdate = true;
  }

  restart() {
    this.time = 0;
    this.running = false;
    this.finished = false;
    this.deaths = 0;
    this.clock = 0;
    this.checkpointIndex = 0;
    for (const c of this.checkpoints) {
      c.reached = c.index === 0;
      c.cloth.material = c.reached ? this.mats.flagOn : this.mats.flag;
    }
    for (const v of this.vanishers) this.resetVanisher(v);
    this.el.finish.hidden = true;
    this.best = Number(localStorage.getItem(BEST_KEY)) || 0;
    this.spawnAt(this.start, Math.PI * 0);
    this.game.yaw = 0;
    this.game.pitch = -0.25;
    this.toast('GO!', false);
  }

  spawnAt(pos, yaw = null) {
    this.body = newBody(pos[0], pos[1] + 0.05, pos[2]);
    this.lastGroundT = 0;
    this.facing = yaw ?? this.facing ?? 0;
    this.knockUntil = 0;
  }

  respawn(manual = false) {
    if (this.finished) return;
    const cp = this.checkpoints[this.checkpointIndex];
    this.deaths++;
    this.el.fade.style.opacity = '0.85';
    setTimeout(() => { this.el.fade.style.opacity = '0'; }, 180);
    this.spawnAt([cp.spawn[0], cp.spawn[1], cp.spawn[2]]);
    this.game.audio.moo(null, 1.2);
    if (!manual) this.toast('SPLASH!', true);
  }

  resetVanisher(v) {
    v.state = 'solid';
    v.t = 0;
    v.mesh.visible = true;
    v.mesh.material.opacity = 1;
    v.mesh.position.copy(v.home);
    const hw = v.w / 2, hd = v.d / 2;
    v.box.min = [v.home.x - hw, v.home.y - v.h / 2, v.home.z - hd];
    v.box.max = [v.home.x + hw, v.home.y + v.h / 2, v.home.z + hd];
  }

  toast(text, bad) {
    const el = this.el.toast;
    el.textContent = text;
    el.classList.toggle('bad', !!bad);
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  // ─── Simulation ──────────────────────────────────────────────
  standingOn(box) {
    const b = this.body;
    const r = PLAYER.RADIUS * 0.9;
    return b.onGround && Math.abs(b.y - box.max[1]) < 0.09
      && b.x > box.min[0] - r && b.x < box.max[0] + r && b.z > box.min[2] - r && b.z < box.max[2] + r;
  }

  update(dt) {
    if (!this.active) return;
    const game = this.game;
    const now = performance.now() / 1000;
    this.clock += dt;
    const b = this.body;

    // moving platforms carry whoever stands on them
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

    // collapsing cheese
    for (const v of this.vanishers) {
      if (v.state === 'solid' && this.standingOn(v.box)) { v.state = 'shaking'; v.t = 0; this.game.audio.blockBreak(null); }
      if (v.state === 'shaking') {
        v.t += dt;
        v.mesh.position.set(v.home.x + (Math.random() - 0.5) * 0.08, v.home.y, v.home.z + (Math.random() - 0.5) * 0.08);
        if (v.t > 0.55) {
          v.state = 'gone'; v.t = 0;
          v.box.min = [0, -1000, 0]; v.box.max = [0, -999, 0];
        }
      } else if (v.state === 'gone') {
        v.t += dt;
        v.mesh.position.y -= dt * 6;
        v.mesh.material.opacity = Math.max(0, 1 - v.t * 1.5);
        if (v.t > 3) this.resetVanisher(v);
      }
    }

    // input (camera-relative) with generous air control, coyote time and jump buffering
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
      const wantJump = performance.now() - game.jumpQueued < 140;
      if (wantJump && !b.onGround && now - this.lastGroundT < 0.12 && b.vy <= 0.5) {
        b.vy = PLAYER.JUMP_V;
        game.jumpQueued = 0;
        this.lastGroundT = 0;
      }
      const knocked = now < this.knockUntil;
      stepBody(b, {
        wx: knocked ? 0 : wx, wz: knocked ? 0 : wz, jump: wantJump && b.onGround, walk: k.has('ShiftLeft'),
        crouch: false, speedMult: 1.05, airControl: true,
      }, dt, this.boxes);
      if (b.jumped) { b.jumped = false; game.jumpQueued = 0; }
      if (b.landedSpeed > 9) game.audio.land(null);
      if (l > 0 && !knocked) this.facing = Math.atan2(-wx, -wz);
      if (!this.running && (l > 0 || !b.onGround)) this.running = true;
      if (this.running) this.time += dt;
    }

    // churn spinners knock you off
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

    // pads, sour milk, checkpoints, finish
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
    for (const cp of this.checkpoints) {
      if (cp.reached || !this.standingOn(cp.zone)) continue;
      cp.reached = true;
      if (cp.index > this.checkpointIndex) this.checkpointIndex = cp.index;
      cp.cloth.material = this.mats.flagOn;
      this.toast('CHECKPOINT!', false);
      game.audio.killConfirm(2);
    }
    if (!this.finished && b.x > this.finishZone.min[0] && b.x < this.finishZone.max[0] && b.z > this.finishZone.min[2] && b.z < this.finishZone.max[2] && b.y >= this.finishZone.min[1] - 0.05 && b.y < this.finishZone.max[1]) {
      this.finish();
    }
    if (b.y < KILL_Y) this.respawn();

    // cow model
    const speed = Math.hypot(b.vx, b.vz);
    this.cow.root.position.set(b.x, b.y, b.z);
    const cur = this.cow.root.rotation.y;
    let diff = this.facing - cur;
    diff = Math.atan2(Math.sin(diff), Math.cos(diff));
    this.cow.root.rotation.y = cur + diff * Math.min(1, dt * 12);
    this.cow.update(dt, { speed, crouch: 0, pitch: 0, onGround: b.onGround });
    for (const s of this.statues) s.update(dt, { speed: 0, crouch: 0, pitch: Math.sin(this.clock) * 0.2, onGround: true });

    // scenery motion
    this.bell.rotation.y += dt * 1.2;
    this.bell.position.y += Math.sin(this.clock * 2) * 0.004;
    for (const d of this.decor) {
      if (d.drift) d.obj.position.x += Math.sin(this.clock * 0.05 + d.drift) * d.drift * dt;
      if (d.baseY != null) d.obj.position.y = d.baseY + Math.sin(this.clock * 0.8 + d.bob) * 0.6;
    }

    // third-person camera
    const cam = game.camera;
    if (cam.fov !== game.settings.fov) { cam.fov = game.settings.fov; cam.updateProjectionMatrix(); }
    const elev = Math.min(1.15, Math.max(-0.3, -game.pitch + 0.15));
    const dist = 6.5;
    const head = new THREE.Vector3(b.x, b.y + 1.7, b.z);
    cam.position.set(
      head.x + Math.sin(game.yaw) * Math.cos(elev) * dist,
      head.y + Math.sin(elev) * dist,
      head.z + Math.cos(game.yaw) * Math.cos(elev) * dist,
    );
    cam.lookAt(head);
    game.audio.setListener(b.x, b.y, b.z, game.yaw);

    this.sun.position.set(b.x + 25, b.y + 45, b.z + 18);
    this.sun.target.position.set(b.x, b.y, b.z);

    this.updateHud();
  }

  finish() {
    this.finished = true;
    this.running = false;
    const t = this.time;
    const prev = this.best;
    const isBest = !prev || t < prev;
    if (isBest) {
      try { localStorage.setItem(BEST_KEY, String(t)); } catch { /* storage unavailable */ }
      this.best = t;
    }
    this.game.audio.jingle(true);
    this.game.audio.moo(null, 0.9);
    this.el.finishTime.textContent = formatRunTime(t);
    this.el.finishSub.textContent = `${this.deaths} ${this.deaths === 1 ? 'splash' : 'splashes'} · ${isBest ? (prev ? `New personal best! (was ${formatRunTime(prev)})` : 'First clear — personal best set!') : `Personal best ${formatRunTime(prev)}`}`;
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
      c.style.transform = `rotate(${Math.random() * 360}deg)`;
      this.el.finish.appendChild(c);
      setTimeout(() => c.remove(), 5500);
    }
  }

  updateHud() {
    const idx = Math.min(STAGES.length - 1, this.checkpointIndex);
    this.set('stage', `Stage ${idx + 1} · ${STAGES[idx]}`);
    this.set('timer', formatRunTime(this.time));
    this.set('deaths', `💦 ${this.deaths}`);
    this.set('check', `🚩 ${this.checkpointIndex}/${this.checkpoints.length - 1}`);
    this.set('best', `🏆 ${this.best ? formatRunTime(this.best) : '—'}`);
    const total = Math.abs(this.finalZ);
    const along = Math.min(1, Math.max(0, -this.body.z / total));
    const height = Math.min(1, Math.max(0, (this.body.y - (BASE + 12.5)) / 10.8));
    const frac = this.finished ? 1 : along < 0.93 ? along * 0.9 : 0.84 + height * 0.16;
    this.el.progress.style.width = `${(frac * 100).toFixed(1)}%`;
  }

  set(key, value) {
    this.cache ??= {};
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    this.el[key].textContent = value;
  }
}
