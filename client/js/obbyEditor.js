// Obby Creator — build block courses in the sky, test them, and publish them with an invite code.
import * as THREE from 'three';
import { OBBY_BLOCKS, BLOCK, OBBY_LIMITS, validateObbyBlocks } from '/shared/obby.js';
import { OBBY_BASE, playerName, postJSON } from './obby.js';

const BASE = OBBY_BASE;
const DRAFT_KEY = 'csmoo.obbyDraft';
const MINE_KEY = 'csmoo.myObbies';
const KEY_TO_BLOCK = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5, Digit7: 6, Digit8: 7, Digit9: 8, Digit0: 9, Minus: 10, Equal: 11 };

export function myObbies() {
  try { return JSON.parse(localStorage.getItem(MINE_KEY) || '[]'); } catch { return []; }
}

function rememberObby(entry) {
  const list = myObbies().filter((o) => o.code !== entry.code);
  list.unshift(entry);
  try { localStorage.setItem(MINE_KEY, JSON.stringify(list.slice(0, 30))); } catch { /* storage unavailable */ }
}

export function inviteLink(code) {
  return `${location.origin}/?obby=${encodeURIComponent(code.toUpperCase())}`;
}

function starterBlocks() {
  const blocks = [];
  for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) blocks.push([x, 0, z, x === 0 && z === 0 ? BLOCK.START : BLOCK.GRASS]);
  blocks.push([0, 0, -5, BLOCK.HAY], [0, 1, -8, BLOCK.CRATE], [1, 1, -11, BLOCK.CHEESE], [0, 1, -14, BLOCK.FINISH]);
  return blocks;
}

export class ObbyEditor {
  constructor(game) {
    this.game = game;
    this.active = false;
    this.suspended = false;
    this.selected = 0;
    const $ = (id) => document.getElementById(id);
    this.el = {
      hud: $('editorHud'), name: $('edName'), count: $('edCount'), palette: $('edPalette'), toast: $('edToast'),
      share: $('edShare'), shareCode: $('edShareCode'), shareLink: $('edShareLink'), cross: $('edCross'),
      undo: $('edUndo'), test: $('edTest'), save: $('edSave'), exit: $('edExit'), newBtn: $('edNew'),
      copy: $('edCopy'), shareClose: $('edShareClose'), status: $('edStatus'),
    };
    this.el.palette.innerHTML = OBBY_BLOCKS.map((b) => `<button class="ed-block" data-t="${b.id}" title="${b.name}"><i style="background:${b.color}"></i><kbd>${b.key}</kbd><span>${b.name}</span></button>`).join('');
    this.el.palette.addEventListener('click', (e) => {
      const btn = e.target.closest('.ed-block');
      if (btn) this.select(Number(btn.dataset.t));
    });
    this.el.undo.onclick = () => this.undo();
    this.el.test.onclick = () => this.test();
    this.el.save.onclick = () => this.save();
    this.el.exit.onclick = () => this.exit();
    this.el.newBtn.onclick = () => {
      if (!window.confirm('Start a new blank obby? Your current draft will be replaced.')) return;
      this.load({ name: '', blocks: starterBlocks() });
    };
    this.el.copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(this.el.shareLink.textContent);
        this.el.copy.textContent = 'Copied!';
      } catch {
        this.el.copy.textContent = 'Select the link above to copy';
      }
      setTimeout(() => { this.el.copy.textContent = 'Copy invite link'; }, 1800);
    };
    this.el.shareClose.onclick = () => {
      this.el.share.hidden = true;
      this.game.lockPointer();
    };
    this.el.name.addEventListener('input', () => {
      this.def.name = this.el.name.value;
      this.saveDraft();
    });
    this.el.name.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') this.el.name.blur(); });
  }

  // ─── Lifecycle ───────────────────────────────────────────────
  start(def = null) {
    const obby = this.game.obby;
    obby.ensureBase();
    if (obby.root) obby.root.visible = false;
    obby.cow.root.visible = false;
    this.scene = obby.scene;
    this.mats = obby;
    if (!this.group) this.buildScaffold();
    this.group.visible = true;
    let draft = null;
    try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { /* ignore */ }
    this.load(def || draft || { name: '', blocks: starterBlocks() });
    this.cam = new THREE.Vector3(0.5, BASE + 7, 11);
    this.game.yaw = 0;
    this.game.pitch = -0.45;
    this.active = true;
    this.suspended = false;
    this.el.hud.hidden = false;
    this.el.share.hidden = true;
    this.game.renderer.shadowMap.autoUpdate = true;
    this.select(this.selected);
  }

  load(def) {
    this.def = { code: def.code || null, editKey: def.editKey || null, name: def.name || '', blocks: def.blocks || [] };
    this.cells = new Map();
    for (const [x, y, z, t] of this.def.blocks) this.cells.set(`${x},${y},${z}`, t);
    this.history = [];
    this.el.name.value = this.def.name;
    this.dirty = true;
    this.saveDraft();
    this.updateStatus();
  }

  suspend() {
    this.active = false;
    this.suspended = true;
    this.group.visible = false;
    this.el.hud.hidden = true;
  }

  resume() {
    const obby = this.game.obby;
    if (obby.root) obby.root.visible = false;
    obby.cow.root.visible = false;
    this.active = true;
    this.suspended = false;
    this.group.visible = true;
    this.el.hud.hidden = false;
    this.game.renderer.shadowMap.autoUpdate = true;
  }

  stop() {
    this.active = false;
    this.suspended = false;
    if (this.group) this.group.visible = false;
    if (this.game.obby?.cow) this.game.obby.cow.root.visible = true;
    this.el.hud.hidden = true;
    this.el.share.hidden = true;
  }

  exit() {
    this.saveDraft();
    this.game.onLeave?.();
  }

  buildScaffold() {
    this.group = new THREE.Group();
    this.scene.add(this.group);
    const grid = new THREE.GridHelper(OBBY_LIMITS.XZ * 2, OBBY_LIMITS.XZ * 2, 0x2f5d9e, 0x8aa6c8);
    grid.position.set(0, BASE + 0.002, 0);
    grid.material.transparent = true;
    grid.material.opacity = 0.45;
    this.group.add(grid);
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(OBBY_LIMITS.XZ * 2, OBBY_LIMITS.XZ * 2),
      new THREE.MeshBasicMaterial({ color: 0xdfeaf6, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = BASE;
    this.group.add(floor);
    this.blockGroup = new THREE.Group();
    this.group.add(this.blockGroup);
    this.ghost = new THREE.Mesh(new THREE.BoxGeometry(1.02, 1.02, 1.02), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, depthWrite: false }));
    this.ghostEdges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.03, 1.03, 1.03)), new THREE.LineBasicMaterial({ color: 0xffffff }));
    this.removeEdges = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.06, 1.06, 1.06)), new THREE.LineBasicMaterial({ color: 0xe5484d }));
    this.group.add(this.ghost, this.ghostEdges, this.removeEdges);
  }

  // ─── Editing ─────────────────────────────────────────────────
  select(t) {
    this.selected = (t + OBBY_BLOCKS.length) % OBBY_BLOCKS.length;
    this.el.palette.querySelectorAll('.ed-block').forEach((b) => b.classList.toggle('active', Number(b.dataset.t) === this.selected));
    this.ghost.material.color.set(OBBY_BLOCKS[this.selected].color);
  }

  cycle(dir) { this.select(this.selected + dir); }

  onKey(e) {
    if (e.code in KEY_TO_BLOCK) this.select(KEY_TO_BLOCK[e.code]);
    if (e.code === 'KeyT' && !e.repeat) this.test();
    if (e.code === 'KeyZ' && (e.ctrlKey || e.metaKey)) this.undo();
    if (e.code === 'KeyQ' && !e.repeat) this.pick();
  }

  /** Voxel ray walk from the camera: returns the block hit and the empty cell in front of it. */
  target() {
    const cam = this.game.camera;
    const o = cam.position;
    const dir = new THREE.Vector3();
    cam.getWorldDirection(dir);
    const oy = o.y - BASE;
    let x = Math.floor(o.x), y = Math.floor(oy), z = Math.floor(o.z);
    const sx = Math.sign(dir.x), sy = Math.sign(dir.y), sz = Math.sign(dir.z);
    const tdx = sx ? Math.abs(1 / dir.x) : Infinity;
    const tdy = sy ? Math.abs(1 / dir.y) : Infinity;
    const tdz = sz ? Math.abs(1 / dir.z) : Infinity;
    let tmx = sx ? (sx > 0 ? x + 1 - o.x : o.x - x) * tdx : Infinity;
    let tmy = sy ? (sy > 0 ? y + 1 - oy : oy - y) * tdy : Infinity;
    let tmz = sz ? (sz > 0 ? z + 1 - o.z : o.z - z) * tdz : Infinity;
    const planeT = dir.y < 0 && oy > 0 ? -oy / dir.y : Infinity;
    let t = 0;
    let prev = null;
    for (let i = 0; i < 400 && t < 45; i++) {
      if (this.cells.has(`${x},${y},${z}`)) return { hit: [x, y, z], place: prev };
      if (t >= planeT) {
        return { hit: null, place: [Math.floor(o.x + dir.x * planeT), 0, Math.floor(o.z + dir.z * planeT)] };
      }
      prev = [x, y, z];
      if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; }
      else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; }
      else { z += sz; t = tmz; tmz += tdz; }
    }
    if (planeT < 45) return { hit: null, place: [Math.floor(o.x + dir.x * planeT), 0, Math.floor(o.z + dir.z * planeT)] };
    return null;
  }

  canPlace(cell) {
    if (!cell) return false;
    const [x, y, z] = cell;
    return Math.abs(x) <= OBBY_LIMITS.XZ && Math.abs(z) <= OBBY_LIMITS.XZ && y >= 0 && y <= OBBY_LIMITS.Y && !this.cells.has(`${x},${y},${z}`);
  }

  apply(changes) {
    for (const [key, after] of changes) {
      if (after === undefined) this.cells.delete(key);
      else this.cells.set(key, after);
    }
    this.dirty = true;
    this.saveDraft();
    this.updateStatus();
  }

  place() {
    if (!this.active || !this.game.locked) return;
    const tgt = this.target();
    if (!tgt || !this.canPlace(tgt.place)) return;
    if (this.cells.size >= OBBY_LIMITS.MAX_BLOCKS) return this.toast(`Block limit reached (${OBBY_LIMITS.MAX_BLOCKS})`, true);
    const key = tgt.place.join(',');
    const changes = [];
    if (this.selected === BLOCK.START) {
      for (const [k, t] of this.cells) if (t === BLOCK.START) changes.push([k, undefined, t]);
    }
    changes.push([key, this.selected, undefined]);
    this.history.push(changes);
    this.apply(changes);
    this.game.audio.blockPlace(null);
  }

  remove() {
    if (!this.active || !this.game.locked) return;
    const tgt = this.target();
    if (!tgt?.hit) return;
    const key = tgt.hit.join(',');
    const changes = [[key, undefined, this.cells.get(key)]];
    this.history.push(changes);
    this.apply(changes);
    this.game.audio.blockBreak(null);
  }

  /** Eyedropper: select the type of the block you're looking at. */
  pick() {
    const tgt = this.target();
    if (tgt?.hit) this.select(this.cells.get(tgt.hit.join(',')));
  }

  undo() {
    const changes = this.history.pop();
    if (!changes) return this.toast('Nothing to undo');
    this.apply(changes.map(([key, after, before]) => [key, before, after]).reverse());
  }

  blocks() {
    return [...this.cells].map(([key, t]) => [...key.split(',').map(Number), t]);
  }

  saveDraft() {
    clearTimeout(this.draftTimer);
    this.draftTimer = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY, JSON.stringify({ code: this.def.code, editKey: this.def.editKey, name: this.def.name, blocks: this.blocks() }));
      } catch { /* storage full or unavailable */ }
    }, 300);
  }

  updateStatus() {
    const count = this.cells.size;
    let starts = 0, finishes = 0, checks = 0;
    for (const t of this.cells.values()) {
      if (t === BLOCK.START) starts++;
      if (t === BLOCK.FINISH) finishes++;
      if (t === BLOCK.CHECK) checks++;
    }
    this.el.count.textContent = `${count} / ${OBBY_LIMITS.MAX_BLOCKS} blocks`;
    this.el.status.innerHTML = `${starts ? '✅' : '⚠️'} Start · ${finishes ? '✅' : '⚠️'} Finish · 🚩 ${checks} checkpoint${checks === 1 ? '' : 's'}${this.def.code ? ` · Code <b>${this.def.code.toUpperCase()}</b>` : ''}`;
  }

  toast(text, bad = false) {
    const el = this.el.toast;
    el.textContent = text;
    el.classList.toggle('bad', bad);
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  rebuild() {
    this.dirty = false;
    for (const child of [...this.blockGroup.children]) {
      this.blockGroup.remove(child);
      child.dispose?.();
    }
    const obby = this.game.obby;
    const byType = new Map();
    for (const [key, t] of this.cells) {
      if (!byType.has(t)) byType.set(t, []);
      byType.get(t).push(key.split(',').map(Number));
    }
    const m4 = new THREE.Matrix4();
    for (const [t, cells] of byType) {
      const mesh = new THREE.InstancedMesh(obby.unitBox, obby.blockMaterial(t), cells.length);
      cells.forEach(([x, y, z], i) => mesh.setMatrixAt(i, m4.makeTranslation(x + 0.5, BASE + y + 0.5, z + 0.5)));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.blockGroup.add(mesh);
    }
  }

  // ─── Test & publish ──────────────────────────────────────────
  course() {
    const check = validateObbyBlocks(this.blocks());
    if (!check.ok) {
      this.toast(check.error, true);
      return null;
    }
    return { code: this.def.code, name: this.def.name.trim() || 'Untitled obby', author: playerName(), blocks: check.blocks, rev: Date.now() };
  }

  test() {
    const course = this.course();
    if (!course) return;
    this.game.startObby(course, { fromEditor: true });
    this.game.lockPointer();
  }

  async save() {
    const course = this.course();
    if (!course) return;
    this.el.save.disabled = true;
    this.el.save.textContent = 'Saving…';
    const res = await postJSON('/api/obbies', { ...course, code: this.def.code, editKey: this.def.editKey });
    this.el.save.disabled = false;
    this.el.save.textContent = '💾 Save & share';
    if (!res || res.error) return this.toast(res?.error || 'Save failed', true);
    this.def.code = res.code;
    this.def.editKey = res.editKey;
    rememberObby({ code: res.code, editKey: res.editKey, name: course.name, updated: Date.now() });
    this.saveDraft();
    this.updateStatus();
    this.el.shareCode.textContent = res.code.toUpperCase();
    this.el.shareLink.textContent = inviteLink(res.code);
    this.el.share.hidden = false;
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // ─── Frame ───────────────────────────────────────────────────
  update(dt) {
    if (!this.active) return;
    const game = this.game;
    if (this.dirty) this.rebuild();
    const k = game.keys;
    const yaw = game.yaw;
    const fwd = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
    const str = (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0);
    const up = (k.has('Space') ? 1 : 0) - (k.has('ShiftLeft') || k.has('ControlLeft') ? 1 : 0);
    const speed = 14;
    this.cam.x += (-Math.sin(yaw) * fwd + Math.cos(yaw) * str) * speed * dt;
    this.cam.z += (-Math.cos(yaw) * fwd - Math.sin(yaw) * str) * speed * dt;
    this.cam.y = Math.min(BASE + 70, Math.max(BASE - 6, this.cam.y + up * speed * dt));
    const cam = game.camera;
    if (cam.fov !== game.settings.fov) { cam.fov = game.settings.fov; cam.updateProjectionMatrix(); }
    cam.position.copy(this.cam);
    cam.rotation.set(game.pitch, yaw, 0, 'YXZ');
    cam.updateMatrixWorld();

    const obby = game.obby;
    obby.sun.position.set(this.cam.x + 25, BASE + 45, this.cam.z + 18);
    obby.sun.target.position.set(this.cam.x, BASE, this.cam.z - 8);

    const tgt = game.locked ? this.target() : null;
    const canPlace = tgt && this.canPlace(tgt.place);
    this.ghost.visible = this.ghostEdges.visible = !!canPlace;
    if (canPlace) {
      const [x, y, z] = tgt.place;
      this.ghost.position.set(x + 0.5, BASE + y + 0.5, z + 0.5);
      this.ghostEdges.position.copy(this.ghost.position);
    }
    this.removeEdges.visible = !!tgt?.hit;
    if (tgt?.hit) this.removeEdges.position.set(tgt.hit[0] + 0.5, BASE + tgt.hit[1] + 0.5, tgt.hit[2] + 0.5);
    this.el.cross.hidden = !game.locked;
  }
}
