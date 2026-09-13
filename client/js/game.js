// Client game controller: rendering loop, input, local prediction, shooting, remote entities & event handling.
import * as THREE from 'three';
import { WEAPONS, RECOIL, INTERP_DELAY, UTIL, TEAMS, ROUND, HUMAN_SPREAD, RECOIL_VIEW, BLOCKS } from '/shared/constants.js';
import { MAP, siteAt, setActiveMap, instanceMap } from '/shared/map.js';
import {
  newBody, stepBody, eyeHeight, playerHeight, raycastWorld, rayPlayer, shotDirection, dirFromAngles, lineClear,
} from '/shared/physics.js';
import { computeSpread } from '/shared/combat.js';
import { buildWorld, IMPACT_COLORS } from './world.js';
import { CowModel } from './cow.js';
import { ViewModel, buildWeaponMesh } from './viewmodel.js';
import { Effects } from './effects.js';
import { Net } from './net.js';
import { labelTexture } from './textures.js';
import { weaponLabel } from './hud.js';

const TAU = Math.PI * 2;
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const lerp = (a, b, t) => a + (b - a) * t;
const REASONS = {
  elim: 'All enemies eliminated',
  time: 'Time ran out — the sites held',
  bomb: 'The Sour Milk Bomb detonated',
  defuse: 'The bomb has been defused',
};

export class Game {
  constructor({ canvas, hud, audio, settings, onLeave }) {
    this.canvas = canvas;
    this.hud = hud;
    this.audio = audio;
    this.settings = settings;
    this.onLeave = onLeave;

    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.autoClear = false;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.05, 1600);
    this.camera.rotation.order = 'YXZ';
    setActiveMap(instanceMap(MAP.name));
    this.world = buildWorld(this.scene, r, { shadows: settings.shadows });
    this.mapName = MAP.name;
    this.gameMode = 'defusal';
    this.blocks = new Map();
    this.initBlockAssets();
    this.vm = new ViewModel();
    this.vm.scene.environment = this.scene.environment;
    this.vm.scene.environmentIntensity = 0.8;
    this.effects = new Effects(this.scene);

    this.bombMesh = buildWeaponMesh('bomb');
    this.bombMesh.scale.setScalar(2.2);
    this.bombMesh.visible = false;
    this.scene.add(this.bombMesh);

    this.mode = 'menu';
    this.keys = new Set();
    this.mouse = { left: false, right: false, dx: 0, dy: 0 };
    this.lastFrame = performance.now();
    this.fpsFrames = 0;
    this.fpsTime = 0;
    this.fps = 0;
    this.menuAngle = 0;
    this.shake = 0;
    this.shakeT = 0;
    this.resetState();
    this.bindInput();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    requestAnimationFrame((t) => this.frame(t));
  }

  resetState() {
    this.me = { id: 0, team: 'T', alive: false, hp: 100, ar: 0, hm: false, m: 800, pri: null, sec: 'udder9', gr: [], bomb: false, kit: false, act: 'udder9', am: {}, use: null, buy: false, buyLeft: 0 };
    this.body = newBody(0, 0, 50);
    this.yaw = 0;
    this.pitch = 0;
    this.recoilIndex = 0;
    this.lastShotT = -10;
    this.nextAttackT = 0;
    this.triggerFresh = true;
    this.reloadUntil = 0;
    this.deployUntil = 0;
    this.scoped = 0;
    this.primed = null;
    this.lastWeapon = 'hoof';
    this.lastSwitchT = -10;
    this.ammoLockUntil = 0;
    this.pendingSwitch = null;
    this.phase = 'waiting';
    this.timeLeft = 0;
    this.timeRecv = performance.now();
    this.score = { T: 0, CT: 0 };
    this.round = 0;
    this.bomb = null;
    this.nextBeep = 0;
    this.entities = new Map();
    this.nades = new Map();
    this.roster = [];
    this.spectateId = null;
    this.deathT = 0;
    this.killerId = null;
    this.flashUntil = 0;
    this.flashDur = 0;
    this.flashFull = true;
    this.lastIn = 0;
    this.stepDist = 0;
    this.useHeld = false;
    this.jumpQueued = 0;
    this.uiOpen = null;
    this.punchExtra = 0;
    this.spotted = new Set();
    this.nextSpot = 0;
    this.needWeaponRefresh = true;
    this.useLocalStart = 0;
    this.cdLast = null;
    this.streak = 0;
    this.streakT = 0;
    this.rescopeAt = 0;
  }

  loadMap(name) {
    if (!name || name === this.mapName) return;
    this.world.dispose();
    this.clearBlocks();
    setActiveMap(instanceMap(name));
    this.mapName = name;
    this.world = buildWorld(this.scene, this.renderer, { shadows: this.settings.shadows });
    this.vm.scene.environment = this.scene.environment;
    this.hud.setMap();
  }

  get ffaLike() {
    return this.gameMode === 'ffa' || this.gameMode === 'duel';
  }

  isEnemy(e) {
    return this.ffaLike ? e.id !== this.me.id : e.team !== this.me.team;
  }

  recoilPunch(w) {
    const rec = RECOIL[w?.recoil] || RECOIL.none;
    const idx = Math.min(this.recoilIndex, rec.length - 1);
    const i0 = Math.floor(idx), i1 = Math.min(rec.length - 1, i0 + 1);
    const f = idx - i0;
    return [lerp(rec[i0][0], rec[i1][0], f) * RECOIL_VIEW, lerp(rec[i0][1], rec[i1][1], f) * RECOIL_VIEW];
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    const pr = Math.min(window.devicePixelRatio || 1, this.settings.renderScale);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.vm.setAspect(w / h);
    this.effects.setViewport(h * pr, this.camera.fov);
  }

  applySettings() {
    this.audio.setVolume(this.settings.volume);
    this.hud.applyCrosshair(this.settings);
    this.resize();
  }

  // ─── Session ───────────────────────────────────────────────
  async join({ room, name, team, mode, action }) {
    this.resetState();
    this.clearBlocks();
    this.net = new Net();
    this.bindNet();
    const welcome = await this.net.connect({ room, name, team, mode, action });
    this.roomCode = welcome.code;
    this.roomPrivate = !!welcome.priv;
    this.me.id = welcome.id;
    this.gameMode = welcome.mode || 'defusal';
    this.loadMap(welcome.map);
    this.room = welcome.room;
    this.mode = 'playing';
    this.hud.show(true);
    this.hud.applyCrosshair(this.settings);
    return welcome;
  }

  leave() {
    this.net?.close();
    this.net = null;
    for (const e of this.entities.values()) this.scene.remove(e.model.root);
    for (const n of this.nades.values()) this.scene.remove(n.mesh);
    this.effects.clear();
    this.clearBlocks();
    this.resetState();
    this.bombMesh.visible = false;
    this.mode = 'menu';
    this.hud.show(false);
    this.hud.closeBuy();
    this.hud.scoreboard(false);
    this.hud.matchEnd(null);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  lockPointer() {
    try {
      this.canvas.requestPointerLock?.()?.catch?.(() => {});
    } catch { /* pointer lock unavailable */ }
  }

  get locked() { return document.pointerLockElement === this.canvas; }

  // ─── Input ─────────────────────────────────────────────────
  bindInput() {
    document.addEventListener('pointerlockchange', () => {
      if (this.mode !== 'playing') return;
      if (this.locked) {
        document.getElementById('pause').hidden = true;
        document.getElementById('clickToPlay').hidden = true;
        this.uiOpen = null;
        return;
      }
      this.keys.clear();
      this.mouse.left = this.mouse.right = false;
      this.setUse(false);
      if (this.uiOpen === 'buy' || this.uiOpen === 'team') return;
      if (this.uiOpen === 'chat') { this.hud.closeChat(); this.uiOpen = null; }
      document.getElementById('pause').hidden = false;
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      const zoom = Math.min(1, this.camera.fov / this.settings.fov);
      const k = 0.0021 * this.settings.sensitivity * zoom;
      this.yaw -= e.movementX * k;
      this.pitch = Math.max(-1.54, Math.min(1.54, this.pitch - e.movementY * k));
      this.mouse.dx += e.movementX;
      this.mouse.dy += e.movementY;
    });

    this.canvas.addEventListener('mousedown', (e) => {
      if (this.mode !== 'playing') return;
      this.audio.init();
      if (!this.locked) { this.lockPointer(); return; }
      if (e.button === 0) { this.mouse.left = true; this.onPrimaryDown(); }
      if (e.button === 2) { this.mouse.right = true; this.onSecondaryDown(); }
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) { this.mouse.left = false; this.triggerFresh = true; this.onPrimaryUp(); }
      if (e.button === 2) { this.mouse.right = false; this.onSecondaryUp(); }
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('wheel', (e) => {
      if (!this.locked || !this.me.alive) return;
      this.cycleWeapon(e.deltaY > 0 ? 1 : -1);
    });

    document.addEventListener('keydown', (e) => {
      if (this.mode !== 'playing' || this.hud.chatOpen) return;
      if (e.code === 'Tab') { e.preventDefault(); this.showScores = true; return; }
      if (this.uiOpen === 'buy') {
        if (e.code === 'KeyB' || e.code === 'Escape') { this.closeBuy(e.code === 'KeyB'); }
        return;
      }
      if (!this.locked) return;
      if (e.repeat && !['KeyW', 'KeyA', 'KeyS', 'KeyD'].includes(e.code)) return;
      this.keys.add(e.code);
      switch (e.code) {
        case 'Space': this.jumpQueued = performance.now(); break;
        case 'KeyR': this.reload(); break;
        case 'Digit1': this.switchTo(this.me.pri); break;
        case 'Digit2': this.switchTo(this.me.sec); break;
        case 'Digit3': this.switchTo('hoof'); break;
        case 'Digit4': this.cycleGrenade(); break;
        case 'Digit5': if (this.me.bomb) this.switchTo('bomb'); break;
        case 'Digit6': case 'KeyX': this.switchTo('cowblock'); break;
        case 'KeyQ': this.switchTo(this.lastWeapon); break;
        case 'KeyB': this.openBuy(); break;
        case 'KeyE': this.setUse(true); break;
        case 'KeyG': if (this.me.act === 'bomb') this.net?.send({ t: 'drop' }); break;
        case 'KeyF': if (this.me.alive && !this.scoped) this.vm.inspect(); break;
        case 'KeyY': case 'KeyU': this.openChat(e.code === 'KeyU' && !this.ffaLike); e.preventDefault(); break;
        case 'KeyM': if (!this.ffaLike) this.openTeamSelect(); break;
      }
    });
    document.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'Tab') this.showScores = false;
      if (e.code === 'KeyE') this.setUse(false);
    });
  }

  openBuy() {
    if (!this.me.alive) return;
    if (!this.me.buy) {
      this.hud.center(this.ffaLike ? 'You can only buy while alive' : this.phase === 'live' ? 'Buy time is over / not in buy zone' : 'You can only buy in your spawn', 1600);
      return;
    }
    this.uiOpen = 'buy';
    document.exitPointerLock();
    this.hud.openBuy((id) => {
      this.net.send({ t: 'buy', item: id });
      this.audio.buy();
    });
    this.hud.refreshBuy(this.me, this.me.team, this.me.buyLeft, this.ffaLike);
  }

  closeBuy(relock) {
    this.hud.closeBuy();
    this.uiOpen = null;
    if (relock) this.lockPointer();
    else document.getElementById('clickToPlay').hidden = false;
  }

  openChat(teamOnly) {
    this.uiOpen = 'chat';
    this.keys.clear();
    this.hud.openChat(teamOnly, (msg) => this.net.send({ t: 'chat', msg, team: teamOnly }), () => { this.uiOpen = null; });
  }

  openTeamSelect() {
    if (this.ffaLike) return;
    this.uiOpen = 'team';
    document.exitPointerLock();
    document.getElementById('teamSelect').hidden = false;
  }

  changeTeam(team) {
    document.getElementById('teamSelect').hidden = true;
    this.uiOpen = null;
    if (team) this.net?.send({ t: 'team', team });
    this.lockPointer();
  }

  setUse(on) {
    if (on === this.useHeld) return;
    this.useHeld = on;
    this.net?.send({ t: 'use', on });
  }

  // ─── Weapons ───────────────────────────────────────────────
  now() { return performance.now() / 1000; }

  switchTo(id, { silent = false } = {}) {
    if (!id || !this.me.alive || id === this.me.act) return;
    const owned = id === 'hoof' || id === this.me.pri || id === this.me.sec || this.me.gr.includes(id) || (id === 'bomb' && this.me.bomb) || (id === 'cowblock' && this.me.blocks > 0);
    if (!owned) return;
    this.lastWeapon = this.me.act;
    this.me.act = id;
    this.lastSwitchT = this.now();
    if (!silent) this.net?.send({ t: 'switch', w: id });
    this.vm.setWeapon(id);
    this.vm.cancelReload();
    const w = WEAPONS[id];
    this.deployUntil = this.now() + (w.deploy ?? 0.5) * 0.7;
    this.reloadUntil = 0;
    this.recoilIndex = 0;
    this.primed = null;
    this.setScope(0);
    this.audio.draw();
    this.setUse(false);
  }

  cycleWeapon(dir) {
    const list = [this.me.pri, this.me.sec, 'hoof', ...new Set(this.me.gr), this.me.bomb ? 'bomb' : null, this.me.blocks > 0 ? 'cowblock' : null].filter(Boolean);
    const i = list.indexOf(this.me.act);
    this.switchTo(list[(i + dir + list.length) % list.length]);
  }

  cycleGrenade() {
    const types = [...new Set(this.me.gr)];
    if (!types.length) return;
    const i = types.indexOf(this.me.act);
    this.switchTo(types[(i + 1) % types.length]);
  }

  setScope(level) {
    this.scoped = level;
    if (this.mode === 'playing') this.net?.send({ t: 'scope', z: level });
  }

  reload() {
    const id = this.me.act;
    const w = WEAPONS[id];
    const a = this.me.am[id];
    if (!this.me.alive || !w?.mag || !a || this.reloadUntil || a[0] >= w.mag || a[1] <= 0) return;
    const dur = w.shellReload || w.reload;
    const style = w.shellReload ? 'shell' : w.cls === 'Pistol' ? 'pistol' : 'mag';
    this.reloadUntil = this.now() + dur;
    this.reloadDur = dur;
    this.vm.reload(dur, style);
    this.audio.reload(dur, style);
    this.net.send({ t: 'reload' });
    this.setScope(0);
    this.ammoLockUntil = this.now() + dur + 0.4;
  }

  onPrimaryDown() {
    const w = WEAPONS[this.me.act];
    if (!this.me.alive) { this.cycleSpectate(); return; }
    if (w?.slot === 'grenade' && this.canAct()) this.primed = 'over';
    if (w?.slot === 'bomb') this.setUse(true);
  }

  onPrimaryUp() {
    const w = WEAPONS[this.me.act];
    if (w?.slot === 'grenade' && this.primed === 'over') this.throwGrenade();
    if (w?.slot === 'bomb' && !this.keys.has('KeyE')) this.setUse(false);
  }

  onSecondaryDown() {
    const w = WEAPONS[this.me.act];
    if (!this.me.alive) return;
    if (w && (w.slot === 'primary' || w.slot === 'secondary')) this.setScope(this.settings.adsToggle && this.scoped ? 0 : 1);
    if (w?.slot === 'grenade' && this.canAct()) this.primed = 'under';
  }

  onSecondaryUp() {
    const w = WEAPONS[this.me.act];
    if (w?.slot === 'grenade' && this.primed === 'under') this.throwGrenade();
    if (this.settings.adsToggle) return;
    this.rescopeAt = 0;
    if (this.scoped) this.setScope(0);
  }

  canAct() {
    return this.me.alive && this.phase !== 'buy' && this.phase !== 'waiting' && !this.uiOpen && this.locked;
  }

  eye() {
    return [this.body.x, this.body.y + eyeHeight(this.body.crouch), this.body.z];
  }

  throwGrenade() {
    const g = this.me.act;
    const under = this.primed === 'under';
    this.primed = null;
    if (!this.canAct() || !this.me.gr.includes(g)) return;
    const dir = dirFromAngles(this.yaw, this.pitch + (under ? 0 : 0.12));
    const speed = under ? 9 : 19;
    const v = [dir[0] * speed + this.body.vx * 0.7, dir[1] * speed + this.body.vy * 0.5 + (under ? 1.5 : 0), dir[2] * speed + this.body.vz * 0.7];
    this.net.send({ t: 'throw', g, v });
    this.vm.throwAnim();
    this.audio.throw(null);
    const i = this.me.gr.indexOf(g);
    this.me.gr.splice(i, 1);
    const next = this.me.gr.includes(g) ? g : (this.me.gr[0] || this.me.pri || this.me.sec || 'hoof');
    this.pendingSwitch = { id: next, at: this.now() + 0.45 };
    this.lastSwitchT = this.now() + 0.45;
  }

  handleFiring() {
    const now = this.now();
    const id = this.me.act;
    const w = WEAPONS[id];
    if (!w || !this.canAct()) return;
    if (this.rescopeAt && now >= this.rescopeAt) {
      this.rescopeAt = 0;
      if (this.mouse.right && w.scope) this.setScope(1);
    }
    if (this.pendingSwitch && now >= this.pendingSwitch.at) {
      const next = this.pendingSwitch.id;
      this.pendingSwitch = null;
      this.lastWeapon = this.me.act;
      this.me.act = next;
      this.vm.setWeapon(next);
      this.deployUntil = now + 0.3;
    }
    if (w.slot === 'melee') {
      const alt = this.mouse.right && !this.mouse.left;
      if ((this.mouse.left || this.mouse.right) && now >= this.nextAttackT && now >= this.deployUntil) {
        this.nextAttackT = now + (alt ? 1.0 : 0.45);
        this.vm.swing(alt);
        this.audio.swing(null);
        this.net.send({ t: 'shoot', w: id, o: this.eye(), d: [dirFromAngles(this.yaw, this.pitch)], rt: this.net.serverNow() - INTERP_DELAY, alt });
      }
      return;
    }
    if (w.slot === 'block') { this.handleBlocks(now); return; }
    if (w.slot !== 'primary' && w.slot !== 'secondary') return;
    if (this.reloadUntil) {
      const ra = this.me.am[id];
      if (w.shellReload && this.mouse.left && this.triggerFresh && ra && ra[0] > 0) {
        // pulling the trigger interrupts a shell-by-shell reload
        this.reloadUntil = 0;
        this.vm.cancelReload();
      } else {
        if (now >= this.reloadUntil) {
          if (ra && w.shellReload) {
            ra[0] = Math.min(w.mag, ra[0] + 1);
            if (ra[0] < w.mag) {
              this.reloadUntil = now + w.shellReload;
              this.reloadDur = w.shellReload;
              this.vm.reload(w.shellReload, 'shell');
              this.audio.reload(w.shellReload, 'shell');
              this.ammoLockUntil = now + w.shellReload + 0.4;
            } else {
              this.reloadUntil = 0;
              this.vm.pump();
              this.audio.pump();
            }
          } else {
            if (ra) { ra[0] = w.mag; ra[1] = w.reserve; }
            this.reloadUntil = 0;
          }
        }
        return;
      }
    }
    if (!this.mouse.left || now < this.deployUntil) return;
    const a = this.me.am[id];
    if (!a) return;
    if (a[0] <= 0) {
      if (this.triggerFresh) {
        this.audio.dryFire();
        this.triggerFresh = false;
        if (a[1] > 0) this.reload();
      }
      return;
    }
    if (now - this.lastShotT < 60 / w.rpm) return;
    if (!w.auto && !this.triggerFresh) return;
    this.triggerFresh = false;
    this.fireShot(w, a);
  }

  fireShot(w, ammo) {
    const now = this.now();
    ammo[0]--;
    this.lastShotT = now;
    this.ammoLockUntil = now + 0.6;
    const scoped = this.scoped > 0 && this.vm.adsT > 0.8;
    const spread = computeSpread(this.body, w, scoped);
    // Bullets travel exactly along the (recoil-kicked) crosshair, plus a small cone of spread.
    const [py, pp] = this.recoilPunch(w);
    const eye = this.eye();
    const aimYaw = this.yaw + (py * Math.PI) / 180;
    const aimPitch = this.pitch + ((pp + this.punchExtra) * Math.PI) / 180;
    const dirs = [];
    for (let i = 0; i < (w.pellets || 1); i++) dirs.push(shotDirection(aimYaw, aimPitch, spread * HUMAN_SPREAD, 0, 0));
    this.recoilIndex++;
    if (w.cls === 'Pistol' || w.cls === 'Sniper' || w.cls === 'Shotgun') this.punchExtra += w.id === 'deag' || w.cls === 'Sniper' ? 2.8 : 1.4;

    const traces = dirs.map((d) => this.localTrace(eye, d, w.range));
    const claims = traces.map((res) => (res.player ? { id: res.player.id, g: res.group } : null));
    this.net.send({ t: 'shoot', w: w.id, o: eye.map((v) => Math.round(v * 1000) / 1000), d: dirs.map((d) => d.map((v) => Math.round(v * 10000) / 10000)), rt: this.net.serverNow() - INTERP_DELAY, h: claims });

    // local visuals
    const strength = w.cls === 'Sniper' ? 1.8 : w.cls === 'Shotgun' ? 1.6 : w.id === 'deag' ? 1.5 : w.suppressed ? 0.5 : 1;
    this.vm.fire(strength);
    this.audio.shot(w.id, null);
    const muzzle = this.vm.muzzleOffset();
    this.camera.updateMatrixWorld();
    const muzzleWorld = this.camera.localToWorld(muzzle.clone());
    this.effects.additive.emit(muzzleWorld.toArray(), [0, 0, 0], { life: 0.05, size: 0.25 * strength, size1: 0.35 * strength, color: 0xfff4d0, alpha: 0.6 });
    for (let i = 0; i < dirs.length; i++) {
      const d = dirs[i];
      const res = traces[i];
      this.effects.tracer(muzzleWorld, res.point);
      if (res.player) this.effects.bloodSplat(res.point, d);
      else if (res.normal) this.effects.impact(res.point, res.normal, IMPACT_COLORS[res.mat] ?? IMPACT_COLORS.ground);
    }
    if (w.scope && this.scoped) {
      this.setScope(0);
      this.rescopeAt = now + 1.1;
    }
    if (ammo[0] === 0 && ammo[1] > 0) setTimeout(() => this.reload(), 250);
  }

  localTrace(o, d, range) {
    const hit = raycastWorld(o, d, range);
    let best = hit ? { t: hit.t, normal: hit.normal, mat: hit.box?.mat || 'ground' } : { t: range };
    for (const e of this.entities.values()) {
      if (!e.alive || !e.pos || !this.isEnemy(e)) continue;
      const ph = rayPlayer(o, d, e.pos, e.crouch);
      if (ph && ph.t < best.t) best = { t: ph.t, player: e, group: ph.group };
    }
    return { ...best, point: [o[0] + d[0] * best.t, o[1] + d[1] * best.t, o[2] + d[2] * best.t] };
  }

  // ─── Cow blocks ────────────────────────────────────────────
  initBlockAssets() {
    const face = (withFace) => {
      const c = document.createElement('canvas');
      c.width = c.height = 128;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#f3efe6';
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = '#1b1b1d';
      for (const [x, y, rr] of [[22, 24, 16], [98, 30, 13], [72, 98, 18], [18, 102, 11], [106, 106, 9]]) {
        ctx.beginPath(); ctx.ellipse(x, y, rr * 1.2, rr, 0.4, 0, Math.PI * 2); ctx.fill();
      }
      if (withFace) {
        ctx.fillStyle = '#f2a0b4';
        ctx.beginPath(); ctx.ellipse(64, 88, 30, 19, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#6a2c3a';
        for (const x of [52, 76]) { ctx.beginPath(); ctx.ellipse(x, 88, 5, 7, 0, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = '#111';
        for (const x of [42, 86]) { ctx.beginPath(); ctx.arc(x, 50, 8, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = '#fff';
        for (const x of [45, 89]) { ctx.beginPath(); ctx.arc(x, 47, 3, 0, Math.PI * 2); ctx.fill(); }
      }
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 8;
      ctx.strokeRect(4, 4, 120, 120);
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      t.magFilter = THREE.NearestFilter;
      return t;
    };
    const side = new THREE.MeshStandardMaterial({ map: face(false), roughness: 0.8 });
    const front = new THREE.MeshStandardMaterial({ map: face(true), roughness: 0.8 });
    this.blockMats = [side, side, side, side, front, front];
    this.blockGeo = new THREE.BoxGeometry(1, 1, 1);
    this.blockGhost = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(1.02, 1.02, 1.02)),
      new THREE.LineBasicMaterial({ color: 0x8fd16a, transparent: true, opacity: 0.9 }),
    );
    this.blockGhost.visible = false;
    this.scene.add(this.blockGhost);
  }

  blockTarget() {
    const eye = this.eye();
    const dir = dirFromAngles(this.yaw, this.pitch);
    const hit = raycastWorld(eye, dir, BLOCKS.REACH);
    if (!hit) return null;
    const n = hit.normal;
    if (!n || (n[0] === 0 && n[1] === 0 && n[2] === 0)) return null;
    const p = [eye[0] + dir[0] * hit.t, eye[1] + dir[1] * hit.t, eye[2] + dir[2] * hit.t];
    const cell = [Math.floor(p[0] + n[0] * 0.5), Math.floor(p[1] + n[1] * 0.5), Math.floor(p[2] + n[2] * 0.5)];
    return { cell, box: hit.box, valid: this.canPlaceAt(cell) };
  }

  canPlaceAt([x, y, z]) {
    const B = MAP.bounds;
    if (y < 0 || y > BLOCKS.MAX_HEIGHT || x < B.minX || x + 1 > B.maxX || z < B.minZ || z + 1 > B.maxZ) return false;
    const E = 0.01;
    for (const b of MAP.boxes) {
      if (x + 1 - E > b.min[0] && x + E < b.max[0] && y + 1 - E > b.min[1] && y + E < b.max[1] && z + 1 - E > b.min[2] && z + E < b.max[2]) return false;
    }
    const bodies = [[this.body.x, this.body.y, this.body.z, this.body.crouch]];
    for (const e of this.entities.values()) if (e.alive && e.pos) bodies.push([e.pos[0], e.pos[1], e.pos[2], e.crouch]);
    for (const [bx, by, bz, c] of bodies) {
      const h = playerHeight(c), r = 0.4;
      if (x + 1 > bx - r && x < bx + r && y + 1 > by && y < by + h && z + 1 > bz - r && z < bz + r) return false;
    }
    return true;
  }

  handleBlocks(now) {
    if (!(this.me.blocks > 0)) return;
    const target = this.blockTarget();
    if (this.mouse.left && now >= (this.nextPlaceT || 0) && target?.valid) {
      this.nextPlaceT = now + BLOCKS.COOLDOWN + 0.02;
      this.net.send({ t: 'place', c: target.cell });
      this.vm.place();
    } else if (this.mouse.right && now >= (this.nextPlaceT || 0) && target?.box?.dyn && target.box.owner === this.me.id) {
      this.nextPlaceT = now + 0.3;
      this.net.send({ t: 'breakBlock', id: target.box.id });
      this.vm.place();
    }
  }

  updateBlockGhost() {
    for (const b of this.blocks.values()) {
      if (b.mesh.scale.x < 1) b.mesh.scale.setScalar(Math.min(1, b.mesh.scale.x + 0.1));
    }
    const show = this.mode === 'playing' && this.me.alive && this.me.act === 'cowblock' && this.me.blocks > 0;
    const target = show ? this.blockTarget() : null;
    this.blockGhost.visible = !!target;
    if (!target) return;
    this.blockGhost.position.set(target.cell[0] + 0.5, target.cell[1] + 0.5, target.cell[2] + 0.5);
    this.blockGhost.material.color.setHex(target.valid ? 0x8fd16a : 0xe5484d);
  }

  addBlock(id, c, owner, fresh = false) {
    if (this.blocks.has(id)) return;
    const box = { min: [c[0], c[1], c[2]], max: [c[0] + 1, c[1] + 1, c[2] + 1], mat: 'cowblock', dyn: true, id, owner };
    MAP.boxes.push(box);
    const mesh = new THREE.Mesh(this.blockGeo, this.blockMats);
    mesh.position.set(c[0] + 0.5, c[1] + 0.5, c[2] + 0.5);
    mesh.rotation.y = (Math.floor(Math.random() * 4) * Math.PI) / 2;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.scene.add(mesh);
    this.blocks.set(id, { box, mesh });
    if (fresh) {
      mesh.scale.setScalar(0.3);
      this.audio.blockPlace([c[0] + 0.5, c[1] + 0.5, c[2] + 0.5]);
      clearTimeout(this.shadowTimer);
      this.shadowTimer = setTimeout(() => this.world.refreshShadows(), 300);
    }
  }

  removeBlock(id, fx = false) {
    const b = this.blocks.get(id);
    if (!b) return;
    const i = MAP.boxes.indexOf(b.box);
    if (i >= 0) MAP.boxes.splice(i, 1);
    this.scene.remove(b.mesh);
    this.blocks.delete(id);
    if (fx) {
      const p = b.mesh.position;
      for (let k = 0; k < 18; k++) {
        this.effects.normal.emit(
          [p.x + (Math.random() - 0.5) * 0.8, p.y + (Math.random() - 0.5) * 0.8, p.z + (Math.random() - 0.5) * 0.8],
          [(Math.random() - 0.5) * 5, Math.random() * 5, (Math.random() - 0.5) * 5],
          { life: 0.8, size: 0.14, size1: 0.08, color: k % 2 ? 0x1b1b1d : 0xf3efe6, gravity: 14, spin: 6 },
        );
      }
      this.audio.blockBreak([p.x, p.y, p.z]);
      clearTimeout(this.shadowTimer);
      this.shadowTimer = setTimeout(() => this.world.refreshShadows(), 100);
    }
  }

  clearBlocks() {
    if (!this.blocks) return;
    for (const id of [...this.blocks.keys()]) this.removeBlock(id);
  }

  /** Falling onto an enemy's head → Moo Stomp (server validates). */
  checkStomp(vyBefore) {
    if (vyBefore > -3 || !this.me.alive) return;
    const now = this.now();
    if (now - (this.lastStompT || 0) < 0.6) return;
    for (const e of this.entities.values()) {
      if (!e.alive || !e.pos || !this.isEnemy(e)) continue;
      const top = e.pos[1] + playerHeight(e.crouch);
      if (Math.hypot(this.body.x - e.pos[0], this.body.z - e.pos[2]) > 0.75) continue;
      if (this.body.y > top + 0.25 || this.body.y < top - 0.55) continue;
      this.lastStompT = now;
      this.net.send({ t: 'stomp', id: e.id, vy: vyBefore, rt: this.net.serverNow() - INTERP_DELAY });
      this.body.vy = 7.5;
      this.body.onGround = false;
      this.audio.stomp(null);
      this.shake = Math.max(this.shake, 0.35);
      break;
    }
  }

  // ─── Networking events ─────────────────────────────────────
  bindNet() {
    const n = this.net;
    n.on('snap', (m) => this.onSnap(m));
    n.on('you', (m) => this.onYou(m));
    n.on('roster', (m) => this.onRoster(m));
    n.on('state', (m) => {
      for (const s of m.smokes) this.effects.smoke(s.id, s.p, s.left);
      for (const f of m.fires) this.effects.fire(f.id, f.p, f.left);
      for (const p of m.puddles) this.effects.puddle(p.p, p.left);
      for (const blk of m.blocks || []) this.addBlock(blk[0], [blk[1], blk[2], blk[3]], blk[4]);
    });
    n.on('spawn', (m) => {
      this.body = newBody(m.p[0], m.p[1], m.p[2]);
      this.yaw = m.yaw;
      this.pitch = 0;
      this.me.alive = true;
      this.setScope(0);
      this.reloadUntil = 0;
      this.recoilIndex = 0;
      this.primed = null;
      this.pendingSwitch = null;
      this.flashUntil = 0;
      this.needWeaponRefresh = true;
      this.spectateId = null;
      this.hud.deathInfo(null);
      this.hud.spectate(null);
      this.ammoLockUntil = 0;
      this.lastSwitchT = -10;
      this.streak = 0;
    });
    n.on('setpos', (m) => {
      this.body.x = m.p[0]; this.body.y = m.p[1]; this.body.z = m.p[2];
      this.body.vx = this.body.vy = this.body.vz = 0;
    });
    n.on('round', (m) => {
      this.score = m.score;
      this.round = m.round;
      if (m.phase === 'buy') {
        this.effects.clear();
        for (const e of this.entities.values()) e.model.revive();
        this.hud.matchEnd(null);
        this.hud.roundIntro(m.round, this.me.team, m.score, this.gameMode);
        this.cdLast = null;
        this.world.refreshShadows();
        this.audio.radio();
      } else if (m.phase === 'live') {
        this.audio.radio();
        if (this.uiOpen === 'buy' && !this.me.buy) this.closeBuy(false);
      }
    });
    n.on('roundEnd', (m) => {
      this.score = m.score;
      const mvp = m.mvpName ? `★ MVP: ${m.mvpName} ${m.mvpReason}` : '';
      this.hud.roundBanner(m.w, REASONS[m.r] || '', mvp);
      const win = m.w === this.me.team;
      this.audio.jingle(win);
      this.audio.say(m.r === 'bomb' ? 'Rogue Bulls win' : `${TEAMS[m.w].name} win`);
    });
    n.on('matchEnd', (m) => {
      setTimeout(() => this.hud.matchEnd(m.w, m.score, m.ffa ? m : null), m.ffa ? 300 : 2500);
    });
    n.on('half', () => {
      this.hud.center('HALFTIME — Switching sides', 4000);
      this.audio.say('Halftime. Switching sides.');
    });
    n.on('kill', (m) => this.onKill(m));
    n.on('hit', (m) => {
      this.hud.hitmarker(m.k);
      this.hud.damageNumber(m.d, m.g === 'head');
      this.audio.hit(m.g === 'head', m.k);
    });
    n.on('hurt', (m) => {
      this.me.hp = m.hp;
      this.hud.hurtFlash(m.d);
      this.audio.hurt();
      this.shake = Math.max(this.shake, Math.min(0.22, m.d / 220));
      if (m.from && m.g !== 'fire') {
        const srcYaw = Math.atan2(-(m.from[0] - this.body.x), -(m.from[2] - this.body.z));
        this.hud.damageIndicator(-angDiff(srcYaw, this.yaw));
        this.punchExtra += Math.min(3, m.d / 12);
      }
    });
    n.on('reward', (m) => { /* money delta animation comes from 'you' */ });
    n.on('shot', (m) => this.onRemoteShot(m));
    n.on('swing', (m) => {
      const e = this.entities.get(m.id);
      if (e?.pos) this.audio.swing(e.pos);
    });
    n.on('throw', (m) => {
      const e = this.entities.get(m.id);
      if (e?.pos) this.audio.throw(e.pos);
    });
    n.on('boom', (m) => this.onBoom(m));
    n.on('fireOut', (m) => this.effects.removeFire(m.id));
    n.on('puddle', (m) => this.effects.puddle(m.p, m.left));
    n.on('flash', (m) => {
      const now = this.now();
      this.flashUntil = Math.max(this.flashUntil, now + m.d);
      this.flashDur = m.d;
      this.flashFull = m.full;
      this.audio.tinnitus(m.d * 0.8);
    });
    n.on('block', (m) => {
      if (m.op === 'add') this.addBlock(m.id, m.c, m.owner, true);
      else if (m.op === 'del') this.removeBlock(m.id, true);
      else if (m.op === 'clear') this.clearBlocks();
    });
    n.on('stomp', (m) => {
      this.effects.bloodSplat(m.p, [0, -1, 0]);
      this.effects.ring(m.p, 0xffffff, 2.5, 0.3);
      this.audio.stomp(m.p);
      if (m.v === this.me.id) this.shake = Math.max(this.shake, 0.6);
    });
    n.on('bomb', (m) => this.onBombEvent(m));
    n.on('chat', (m) => this.hud.addChat(m));
    n.on('leave', (m) => {
      const e = this.entities.get(m.id);
      if (e) { this.scene.remove(e.model.root); this.entities.delete(m.id); }
    });
    n.on('disconnect', () => {
      this.hud.center('Disconnected from server', 4000, true);
      setTimeout(() => this.onLeave?.('Disconnected from server'), 1500);
    });
  }

  onSnap(m) {
    const [phase, timeLeft, sT, sCT, round] = m.r;
    if (phase !== this.phase) {
      if (phase === 'buy') this.keys.delete('Space');
      if (phase === 'live' && this.phase === 'buy') {
        this.hud.countdown('GO', true);
        this.audio.count(true);
        this.cdLast = null;
      }
    }
    this.phase = phase;
    this.timeLeft = timeLeft;
    this.timeRecv = performance.now();
    this.score = { T: sT, CT: sCT };
    this.round = round;
    this.bomb = m.b ? { state: m.b[0], x: m.b[1], y: m.b[2], z: m.b[3], carrier: m.b[4], timer: m.b[5], site: m.b[6] } : null;

    const seen = new Set();
    for (const s of m.ps) {
      const [id, x, y, z, yaw, pitch, crouch, alive, w, hp, flags, vx, vz] = s;
      seen.add(id);
      if (id === this.me.id) {
        this.me.serverAlive = !!alive;
        if (!alive && this.me.alive) this.me.alive = false;
        continue;
      }
      let e = this.entities.get(id);
      const info = this.roster.find((p) => p.id === id);
      const team = info?.team || 'T';
      if (!e || e.team !== team) {
        if (e) this.scene.remove(e.model.root);
        e = this.makeEntity(id, team, info?.name || '');
      }
      e.buf.push({ t: m.st, x, y, z, yaw, pitch, crouch, alive, w, hp, flags, vx, vz });
      while (e.buf.length > 30) e.buf.shift();
    }
    for (const [id, e] of this.entities) {
      if (!seen.has(id)) { this.scene.remove(e.model.root); this.entities.delete(id); }
    }

    // grenades
    const nseen = new Set();
    for (const [id, type, x, y, z] of m.n) {
      nseen.add(id);
      let g = this.nades.get(id);
      if (!g) {
        const mesh = buildWeaponMesh(type);
        mesh.scale.setScalar(1.6);
        this.scene.add(mesh);
        g = { mesh, target: new THREE.Vector3(x, y, z), last: new THREE.Vector3(x, y, z) };
        mesh.position.set(x, y, z);
        this.nades.set(id, g);
      }
      const vy = y - g.target.y;
      if (g.lastVy !== undefined && g.lastVy < -0.01 && vy > 0.01) this.audio.bounce([x, y, z]);
      g.lastVy = vy;
      g.target.set(x, y, z);
    }
    for (const [id, g] of this.nades) if (!nseen.has(id)) { this.scene.remove(g.mesh); this.nades.delete(id); }
  }

  makeEntity(id, team, name) {
    const model = new CowModel(team, this.world.tex);
    this.scene.add(model.root);
    const e = { id, team, name, model, buf: [], alive: true, pos: null, crouch: 0, stepDist: 0, tag: null };
    if (name) this.setTag(e, name);
    this.entities.set(id, e);
    return e;
  }

  setTag(e, name) {
    if (e.tag) e.model.root.remove(e.tag);
    const mat = new THREE.SpriteMaterial({ map: labelTexture(name, TEAMS[e.team].color), depthTest: false, transparent: true });
    const s = new THREE.Sprite(mat);
    s.scale.set(1.6, 0.4, 1);
    s.position.y = 2.25;
    s.renderOrder = 10;
    e.tag = s;
    e.tagName = name;
    e.model.root.add(s);
  }

  onYou(m) {
    const me = this.me;
    const now = this.now();
    if (m.team !== me.team) {
      me.team = m.team;
      this.vm.setTeam(m.team);
      for (const e of this.entities.values()) if (e.tag) this.setTag(e, e.tagName);
    }
    Object.assign(me, { hp: m.hp, ar: m.ar, hm: m.hm, m: m.m, kit: m.kit, bomb: m.bomb, buy: m.buy, buyLeft: m.buyLeft, pri: m.pri, sec: m.sec, rs: m.rs, prot: m.prot, blocks: m.bl ?? 0 });
    this.youT = performance.now();
    if (now > this.lastSwitchT + 0.1) me.gr = [...m.gr];
    if (m.alive !== me.alive && !m.alive) me.alive = false;
    if (m.alive && !me.alive && this.phase !== 'end') me.alive = true;
    if (now > this.ammoLockUntil && !this.reloadUntil) me.am = m.am;
    else for (const id of Object.keys(m.am)) if (!me.am[id] || id !== me.act) me.am[id] = m.am[id];
    if (this.needWeaponRefresh || (m.act !== me.act && now - this.lastSwitchT > 0.8 && !this.pendingSwitch)) {
      this.needWeaponRefresh = false;
      me.act = m.act;
      this.vm.setWeapon(m.act, false);
    }
    if (m.use) {
      if (!me.use) this.useLocalStart = now - m.use.s;
      me.use = m.use;
    } else me.use = null;
    if (this.hud.buyOpen) this.hud.refreshBuy(me, me.team, me.buyLeft, this.ffaLike);
  }

  onRoster(m) {
    this.roster = m.list;
    for (const p of m.list) {
      const e = this.entities.get(p.id);
      if (!e) continue;
      if (e.team !== p.team) {
        this.scene.remove(e.model.root);
        this.entities.delete(p.id);
        const ne = this.makeEntity(p.id, p.team, p.name);
        ne.buf = e.buf;
      } else if (e.tagName !== p.name) {
        this.setTag(e, p.name);
      }
    }
  }

  playerName(id) {
    return this.roster.find((p) => p.id === id);
  }

  onKill(m) {
    const killer = m.k ? this.playerName(m.k) : null;
    const victim = this.playerName(m.v) || { name: '?', team: 'T' };
    this.hud.killfeed({ killer, victim, weapon: m.w, hs: m.hs, wb: m.wb, me: m.k === this.me.id || m.v === this.me.id, ffa: this.ffaLike });
    this.audio.death(m.p, m.v === this.me.id);
    const e = this.entities.get(m.v);
    if (e) { e.model.kill(m.yaw); e.alive = false; }
    if (m.v === this.me.id) {
      this.me.alive = false;
      this.deathT = this.now();
      this.killerId = m.k;
      this.deathPos = [this.body.x, this.body.y + eyeHeight(this.body.crouch), this.body.z];
      this.setScope(0);
      this.setUse(false);
      const color = this.ffaLike ? '#f1f3f5' : TEAMS[killer?.team]?.color || '#f1f3f5';
      const txt = killer && m.k !== this.me.id
        ? `Milked by <span style="color:${color}">${killer.name}</span> · ${weaponLabel(m.w)}${m.hs ? ' · headshot' : ''}`
        : 'You were eliminated';
      this.hud.deathInfo(txt);
      setTimeout(() => this.hud.deathInfo(null), 4000);
    }
    if (m.k === this.me.id && m.v !== this.me.id) {
      const now = this.now();
      this.streak = now - this.streakT < 4 ? this.streak + 1 : 1;
      this.streakT = now;
      this.hud.killConfirm(victim.name, WEAPONS[m.w]?.killReward ?? 300, m.hs, this.streak);
      this.audio.killConfirm(this.streak);
    }
  }

  onRemoteShot(m) {
    const e = this.entities.get(m.id);
    let from = m.o;
    if (e && e.alive && e.model.gun) {
      const v = e.model.muzzleWorld(new THREE.Vector3());
      from = v.toArray();
    }
    const w = WEAPONS[m.w];
    const strength = w?.cls === 'Sniper' ? 1.6 : w?.suppressed ? 0.4 : 1;
    if (!w?.suppressed) this.effects.muzzle(from, null, strength);
    this.audio.shot(m.w, m.o);
    for (const end of m.e) {
      this.effects.tracer(from, end);
      const d = [end[0] - m.o[0], end[1] - m.o[1], end[2] - m.o[2]];
      const len = Math.hypot(...d);
      if (len < 0.1) continue;
      const dn = d.map((v) => v / len);
      const hit = raycastWorld(m.o, dn, len + 0.2);
      if (hit && Math.abs(hit.t - len) < 0.3) this.effects.impact(end, hit.normal, IMPACT_COLORS[hit.box?.mat || 'ground']);
      else if (len < (w?.range ?? 100) - 0.5) this.effects.bloodSplat(end, dn);
    }
  }

  onBoom(m) {
    const p = m.p;
    const dist = Math.hypot(p[0] - this.body.x, p[2] - this.body.z);
    switch (m.g) {
      case 'he': this.effects.explosion(p); this.shake = Math.max(this.shake, Math.max(0, 1 - dist / 25)); break;
      case 'butter': this.effects.flashBurst(p); break;
      case 'smoke': this.effects.smoke(m.id, p); break;
      case 'molotov': this.effects.fire(m.id, p); break;
      case 'fizzle': this.effects.fizzle(p); break;
    }
    this.audio.boom(m.g, p);
    const g = this.nades.get(m.id);
    if (g) { this.scene.remove(g.mesh); this.nades.delete(m.id); }
  }

  onBombEvent(m) {
    const byMe = m.id === this.me.id;
    switch (m.s) {
      case 'planted':
        this.hud.center('The Sour Milk Bomb has been planted', 3500, true);
        this.audio.say('Bomb has been planted');
        this.nextBeep = 0;
        break;
      case 'defused':
        this.hud.center('Bomb defused', 2500);
        break;
      case 'exploded': {
        this.effects.bombExplosion(m.p);
        this.audio.boom('bomb', m.p);
        const dist = Math.hypot(m.p[0] - this.body.x, m.p[2] - this.body.z);
        this.shake = Math.max(this.shake, Math.max(0.3, 1.5 - dist / 40));
        break;
      }
      case 'dropped':
        if (this.me.team === 'T') this.hud.center('The bomb has been dropped!', 2000, true);
        break;
      case 'picked':
        if (byMe) this.hud.center('You picked up the bomb — plant it at A or B', 2500);
        break;
      case 'defusing':
        if (!byMe && this.me.team === 'T') this.hud.center('The bomb is being defused!', 1500, true);
        break;
    }
  }

  cycleSpectate() {
    const mates = [...this.entities.values()].filter((e) => e.alive && e.team === this.me.team);
    if (!mates.length) { this.spectateId = null; return; }
    const i = mates.findIndex((e) => e.id === this.spectateId);
    this.spectateId = mates[(i + 1) % mates.length].id;
  }

  // ─── Frame ─────────────────────────────────────────────────
  frame(tMs) {
    requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.05, (tMs - this.lastFrame) / 1000);
    this.lastFrame = tMs;
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) { this.fps = Math.round(this.fpsFrames / this.fpsTime); this.fpsFrames = 0; this.fpsTime = 0; }

    this.world.update(dt);
    this.effects.update(dt);

    if (this.mode === 'menu') {
      this.menuAngle += dt * 0.05;
      this.camera.fov = 55;
      this.camera.updateProjectionMatrix();
      this.camera.position.set(Math.sin(this.menuAngle) * 58, 26, Math.cos(this.menuAngle) * 58);
      this.camera.lookAt(0, 2, -6);
      this.renderer.clear();
      this.renderer.render(this.scene, this.camera);
      return;
    }

    this.updateLocal(dt);
    this.updateBlockGhost();
    this.updateEntities(dt);
    this.updateCamera(dt);
    this.updateHud(dt);

    this.renderer.clear();
    this.renderer.render(this.scene, this.camera);
    const sniperView = this.me.alive && WEAPONS[this.me.act]?.scope && this.scoped > 0 && this.vm.adsT > 0.9;
    const hideVm = (!this.me.alive && !this.spectateId) || sniperView;
    if (!hideVm) this.vm.render(this.renderer);
  }

  updateLocal(dt) {
    const now = this.now();
    const me = this.me;
    const w = WEAPONS[me.act] || WEAPONS.hoof;

    // recoil recovery
    if (w.recovery && now - this.lastShotT > (60 / (w.rpm || 600)) * 1.3) {
      this.recoilIndex = Math.max(0, this.recoilIndex - w.recovery * dt);
    }
    this.punchExtra *= Math.exp(-dt * 10);

    if (me.alive) {
      const frozen = this.phase === 'buy' || !!me.use || this.uiOpen === 'chat';
      const k = this.keys;
      const fwd = frozen ? 0 : (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
      const str = frozen ? 0 : (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      let wx = fx * fwd + rx * str, wz = fz * fwd + rz * str;
      const l = Math.hypot(wx, wz);
      if (l > 0) { wx /= l; wz /= l; }
      let speedMult = w.speedMult || 1;
      if (this.scoped) speedMult = w.scopedSpeedMult ?? speedMult * 0.72;
      const jump = !frozen && performance.now() - this.jumpQueued < 120;
      const walk = k.has('ShiftLeft') || k.has('ShiftRight');
      const crouch = k.has('ControlLeft') || k.has('KeyC');
      const slick = this.effects.onPuddle(this.body.x, this.body.y, this.body.z);
      const slow = this.effects.inFire(this.body.x, this.body.y, this.body.z);
      const vyBefore = this.body.vy;
      stepBody(this.body, { wx, wz, jump, walk, crouch: crouch && !frozen ? true : crouch, speedMult, slick, slow }, dt);
      this.checkStomp(vyBefore);
      if (this.body.jumped) { this.body.jumped = false; this.jumpQueued = 0; }
      if (this.body.landedSpeed > 6) {
        this.audio.land(null);
        this.shake = Math.max(this.shake, Math.min(0.22, (this.body.landedSpeed - 5) * 0.035));
      }

      const hs = Math.hypot(this.body.vx, this.body.vz);
      if (this.body.onGround && hs > 1) {
        this.stepDist += hs * dt;
        if (this.stepDist > 2.1) {
          this.stepDist = 0;
          if (!walk && this.body.crouch < 0.5 && hs > 3.2) this.audio.footstep(null, true);
        }
      }
      this.handleFiring();

      if (performance.now() - this.lastIn > 33) {
        this.lastIn = performance.now();
        const b = this.body;
        const r3 = (v) => Math.round(v * 1000) / 1000;
        this.net.send({ t: 'in', p: [r3(b.x), r3(b.y), r3(b.z)], v: [r3(b.vx), r3(b.vy), r3(b.vz)], yaw: r3(this.yaw), pitch: r3(this.pitch), c: r3(b.crouch), g: b.onGround ? 1 : 0, w: walk ? 1 : 0 });
      }
    } else if (performance.now() - this.lastIn > 250) {
      this.lastIn = performance.now();
      this.net.send({ t: 'in', yaw: this.yaw, pitch: this.pitch });
    }

    this.audio.setListener(this.camera.position.x, this.camera.position.y, this.camera.position.z, this.yaw);

    // bomb beeps
    const b = this.bomb;
    if (b?.state === 'planted') {
      if (now >= this.nextBeep) {
        const frac = Math.max(0, Math.min(1, b.timer / ROUND.BOMB_TIMER));
        this.nextBeep = now + Math.max(0.1, 1.1 * frac);
        this.audio.beep([b.x, b.y, b.z]);
        this.effects.additive.emit([b.x, b.y + 0.35, b.z], [0, 0, 0], { life: 0.12, size: 0.6, size1: 0.3, color: 0xff2020, alpha: 1 });
      }
    }
    if (me.use && now - (this.lastDefuseTick || 0) > 0.25) {
      this.lastDefuseTick = now;
      this.audio.defuseTick();
    }
  }

  updateEntities(dt) {
    const renderT = this.net.serverNow() - INTERP_DELAY;
    const myEye = this.eye();
    const now = this.now();
    const doSpot = now > this.nextSpot;
    if (doSpot) { this.nextSpot = now + 0.1; this.spotted.clear(); }
    for (const e of this.entities.values()) {
      const buf = e.buf;
      if (!buf.length) { e.model.root.visible = false; continue; }
      let a = buf[0], b = buf[0];
      for (let i = buf.length - 1; i >= 0; i--) {
        if (buf[i].t <= renderT) { a = buf[i]; b = buf[i + 1] || buf[i]; break; }
      }
      const span = b.t - a.t;
      const k = span > 0 ? Math.max(0, Math.min(1, (renderT - a.t) / span)) : 0;
      const x = lerp(a.x, b.x, k), y = lerp(a.y, b.y, k), z = lerp(a.z, b.z, k);
      const yaw = a.yaw + angDiff(b.yaw, a.yaw) * k;
      const pitch = lerp(a.pitch, b.pitch, k);
      const crouch = lerp(a.crouch, b.crouch, k);
      const alive = !!b.alive;
      e.pos = [x, y, z];
      e.yaw = yaw;
      e.pitch = pitch;
      e.crouch = crouch;
      e.flags = b.flags;
      e.weapon = b.w;
      if (alive && !e.alive) e.model.revive();
      if (!alive && e.alive) e.model.kill();
      e.alive = alive;

      const m = e.model;
      m.root.visible = !(this.spectateId === e.id && !this.me.alive);
      m.root.position.set(x, y, z);
      m.root.rotation.y = yaw;
      m.setWeapon(b.w);
      const speed = Math.hypot(b.vx, b.vz);
      m.update(dt, { speed, crouch, pitch, onGround: !!(b.flags & 8), bomb: !!(b.flags & 16), reloading: !!(b.flags & 2), using: !!(b.flags & 4) });
      if (e.tag) e.tag.visible = alive && !this.ffaLike && e.team === this.me.team;

      if (alive && (b.flags & 8) && speed > 3.3) {
        e.stepDist += speed * dt;
        if (e.stepDist > 2.2) { e.stepDist = 0; this.audio.footstep([x, y, z]); }
      }
      if (doSpot && alive && this.isEnemy(e) && this.me.alive) {
        const chest = [x, y + playerHeight(crouch) * 0.6, z];
        if (Math.hypot(x - myEye[0], z - myEye[2]) < 90 && lineClear(myEye, chest) && this.effects.smokeDensity(new THREE.Vector3(...chest)) < 0.5) this.spotted.add(e.id);
      }
    }
    for (const g of this.nades.values()) {
      g.mesh.position.lerp(g.target, Math.min(1, dt * 18));
      g.mesh.rotation.x += dt * 8;
      g.mesh.rotation.z += dt * 5;
    }
    const b = this.bomb;
    if (b && (b.state === 'dropped' || b.state === 'planted')) {
      this.bombMesh.visible = true;
      this.bombMesh.position.set(b.x, b.y + 0.05, b.z);
      if (b.state === 'planted') this.bombMesh.rotation.set(0, 0.6, 0);
      else this.bombMesh.rotation.set(0, 0, Math.PI / 2);
    } else {
      this.bombMesh.visible = false;
    }
  }

  updateCamera(dt) {
    const now = this.now();
    const cam = this.camera;
    const me = this.me;
    let fov = this.settings.fov;
    const w = WEAPONS[me.act];
    if (this.scoped && me.alive && w) {
      const t = this.vm.adsT;
      fov = w.scope ? (t > 0.9 ? w.scope[0] : lerp(fov, fov * 0.85, t)) : lerp(fov, fov * 0.78, t);
    }
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
      this.effects.setViewport(this.renderer.getDrawingBufferSize(new THREE.Vector2()).y, fov);
    }

    this.shake *= Math.exp(-dt * 8);
    this.shakeT += dt;
    const sh = this.shake * 0.02 * this.settings.motionIntensity;
    const shakeYaw = Math.sin(this.shakeT * 51) * sh, shakePitch = Math.cos(this.shakeT * 43) * sh;

    if (me.alive) {
      const speed = Math.hypot(this.body.vx, this.body.vz);
      const bob = this.settings.cameraBob && this.body.onGround && !this.scoped ? Math.min(1, speed / 5.5) * this.settings.motionIntensity : 0;
      const phase = this.now() * (5.5 + speed * 1.7);
      const side = Math.sin(phase) * 0.012 * bob;
      const eyeY = this.body.y + eyeHeight(this.body.crouch) - Math.abs(Math.cos(phase)) * 0.018 * bob;
      cam.position.set(this.body.x + Math.cos(this.yaw) * side, eyeY, this.body.z - Math.sin(this.yaw) * side);
      const [punchY, recoilP] = this.recoilPunch(w);
      const punchP = recoilP + this.punchExtra;
      cam.rotation.set(this.pitch + (punchP * Math.PI) / 180 + shakePitch, this.yaw + (punchY * Math.PI) / 180 + shakeYaw, 0);
      this.hud.spectate(null);
    } else {
      const sinceDeath = now - this.deathT;
      if (sinceDeath < 2.5 || !this.deathPos || this.ffaLike) {
        const p = this.deathPos || [this.body.x, this.body.y + 1.6, this.body.z];
        cam.position.set(p[0], p[1] + Math.min(1.5, sinceDeath * 0.8), p[2]);
        const killer = this.entities.get(this.killerId);
        if (killer?.pos) {
          const d = new THREE.Vector3(killer.pos[0] - cam.position.x, killer.pos[1] + 1.4 - cam.position.y, killer.pos[2] - cam.position.z);
          const yaw = Math.atan2(-d.x, -d.z);
          const pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
          this.yaw += angDiff(yaw, this.yaw) * Math.min(1, dt * 4);
          this.pitch += (pitch - this.pitch) * Math.min(1, dt * 4);
        }
        cam.rotation.set(this.pitch, this.yaw, 0);
        if (this.ffaLike && this.phase === 'live') {
          const left = Math.max(0, (me.rs || 0) - (performance.now() - (this.youT || 0)) / 1000);
          this.hud.spectate(`Respawning in <b>${left.toFixed(1)}s</b><small>Kills earn money · Press B to buy guns that stay with you</small>`);
        } else {
          this.hud.spectate(null);
        }
      } else {
        let target = this.entities.get(this.spectateId);
        if (!target || !target.alive || target.team !== me.team) { this.cycleSpectate(); target = this.entities.get(this.spectateId); }
        if (target?.pos) {
          cam.position.set(target.pos[0], target.pos[1] + eyeHeight(target.crouch), target.pos[2]);
          cam.rotation.set(target.pitch, target.yaw, 0);
          this.vm.setWeapon(target.weapon || 'udder9', true);
          this.hud.spectate(`Spectating <b>${target.name}</b><small>Left click: next player</small>`);
        } else {
          cam.position.set(0, 40, 20);
          cam.rotation.set(-1.1, 0, 0);
          this.hud.spectate('Waiting for next round…');
        }
      }
    }
    cam.updateMatrixWorld();
  }

  updateHud(dt) {
    const hud = this.hud;
    const me = this.me;
    const now = this.now();
    const w = WEAPONS[me.act] || WEAPONS.hoof;

    const speed = Math.hypot(this.body.vx, this.body.vz);
    this.vm.update(dt, {
      speed: me.alive ? speed : 0, onGround: this.body.onGround, crouch: this.body.crouch > 0.5, lookDX: this.mouse.dx, lookDY: this.mouse.dy,
      prime: !!this.primed, using: !!me.use, hidden: false, ads: this.scoped > 0 && me.alive,
    });
    this.mouse.dx = this.mouse.dy = 0;

    const elapsed = (performance.now() - this.timeRecv) / 1000;
    const planted = this.bomb?.state === 'planted';
    if (this.ffaLike) {
      const mine = this.roster.find((p) => p.id === me.id)?.k ?? 0;
      const ranked = [...this.roster].sort((a, b) => b.k - a.k || a.d - b.d);
      const lead = ranked[0] || null;
      const rank = ranked.findIndex((p) => p.id === me.id) + 1;
      hud.setTopbarFFA(this.phase, this.timeLeft - elapsed, mine, lead, rank, this.gameMode);
    } else {
      hud.setTopbar(this.phase, this.timeLeft - elapsed, this.score, this.round, planted);
    }
    if (this.phase === 'buy') {
      const s = Math.ceil(this.timeLeft - elapsed);
      if (s >= 1 && s <= 5 && s !== this.cdLast) {
        this.cdLast = s;
        hud.countdown(String(s));
        this.audio.count(false);
      }
    }
    hud.setAlive(this.roster, me.id);
    hud.setMoney(me.m);
    hud.setVitals(me.alive ? me.hp : 0, me.ar, me.hm);
    const a = me.act === 'cowblock' ? [me.blocks || 0, 0] : me.am[me.act] || [0, 0];
    hud.reloadProgress(this.reloadUntil ? 1 - Math.max(0, this.reloadUntil - this.now()) / (this.reloadDur || 1) : null);
    hud.setAmmo(me.act, a[0], a[1]);
    hud.setInventory(me);
    hud.buyHint(me.buy && me.alive && this.phase !== 'end');
    hud.spawnShield(this.ffaLike && me.alive && me.prot);
    hud.netgraph(this.fps, this.net?.rtt || 0);

    // crosshair
    const adsFull = this.scoped > 0 && this.vm.adsT > 0.8;
    const spread = w.spread != null ? computeSpread(this.body, w, adsFull) : 0;
    hud.crosshairGap(this.settings.dynamicCrosshair ? Math.min(40, spread * 420 + this.recoilIndex * 0.8) : 0);
    hud.crosshairVisible(me.alive && this.vm.adsT < 0.25 && w.cls !== 'Sniper');
    hud.scope(me.alive && !!w.scope && this.scoped > 0 && this.vm.adsT > 0.9);

    // flash
    const left = this.flashUntil - now;
    let flash = 0;
    if (left > 0) flash = Math.min(1, left / Math.min(1.6, this.flashDur * 0.6)) * (this.flashFull ? 1 : 0.8);
    hud.setFlash(flash);
    hud.setSmoke(this.effects.smokeDensity(this.camera.position));
    hud.setFire(me.alive && this.effects.inFire(this.body.x, this.body.y, this.body.z));

    // plant / defuse progress + hints
    if (me.use) {
      const frac = (now - this.useLocalStart) / me.use.n;
      hud.progress(me.use.k === 'plant' ? 'Planting the Sour Milk Bomb' : 'Defusing…', frac);
    } else if (me.alive && this.phase === 'live') {
      const b = this.bomb;
      if (me.bomb && siteAt(this.body.x, this.body.z)) hud.progress(`Hold E to plant at ${siteAt(this.body.x, this.body.z)}`, 0);
      else if (me.team === 'CT' && b?.state === 'planted' && Math.hypot(b.x - this.body.x, b.z - this.body.z) < 2) hud.progress(`Hold E to defuse${me.kit ? ' (kit)' : ''}`, 0);
      else hud.progress(null);
    } else hud.progress(null);

    hud.scoreboard(!!this.showScores, this.roster, me.id, this.score, this.round, this.gameMode);
    if (hud.buyOpen) hud.refreshBuy(me, me.team, me.buyLeft, this.ffaLike);
    if (hud.buyOpen && (!me.buy || !me.alive)) this.closeBuy(false);

    // radar
    const players = [];
    for (const e of this.entities.values()) {
      if (!e.alive || !e.pos) continue;
      const enemy = this.isEnemy(e);
      if (enemy && !this.spotted.has(e.id)) continue;
      players.push({ x: e.pos[0], z: e.pos[2], yaw: e.yaw, team: e.team, enemy, bomb: !!(e.flags & 16) });
    }
    const bombInfo = this.bomb && (this.bomb.state === 'planted' || (this.bomb.state === 'dropped' && me.team === 'T')) ? this.bomb : null;
    const cam = this.camera.position;
    hud.drawRadar({ x: me.alive ? this.body.x : cam.x, z: me.alive ? this.body.z : cam.z, yaw: me.alive ? this.yaw : this.camera.rotation.y, alive: me.alive }, players, bombInfo);
  }
}
