// Authoritative match simulation: defusal rounds / free-for-all, economy, lag-compensated hits, utility, bomb, bots.
import { performance } from 'node:perf_hooks';
import {
  TICK_RATE, SNAPSHOT_RATE, LAG_COMP_MAX, ROUND, ECON, PLAYER, WEAPONS, EQUIPMENT, RECOIL,
  UTIL, GRENADE_IDS, MAX_GRENADES, FFA, DEFAULT_PRIMARY, REGEN, BLOCKS, modeConfig, lossBonus,
} from '../shared/constants.js';
import { MAP, MODES, setActiveMap, instanceMap, inRect, siteAt } from '../shared/map.js';
import {
  newBody, stepBody, raycastAll, raycastWorld, rayPlayer, eyeHeight, playerHeight, lineClear,
  dirFromAngles, shotDirection, boxBlocked, segmentSphere,
} from '../shared/physics.js';
import { computeSpread, armorDamage, rangeFalloff } from '../shared/combat.js';
import { getNav } from './nav.js';
import { BotBrain, BOT_NAMES } from './bot.js';

const TEAM_SIZE = 5;
const r2 = (v) => Math.round(v * 100) / 100;
const nowMs = () => performance.now();

export class Match {
  constructor(name, mode = 'defusal') {
    this.name = name;
    this.mode = MODES[mode] ? mode : 'defusal';
    this.mapName = MODES[this.mode].map;
    this.mapObj = instanceMap(this.mapName);
    this.use();
    this.players = new Map();
    this.nextId = 1;
    this.nav = getNav();
    this.phase = 'waiting';
    this.phaseEnd = 0;
    this.tickCount = 0;
    this.lastTick = nowMs();
    this.nowS = this.lastTick / 1000;
    this.liveStart = this.nowS;
    this.resetMatchState();
    this.timer = setInterval(() => this.tick(), 1000 / TICK_RATE);
    this.emptySince = nowMs();
  }

  use() { setActiveMap(this.mapObj); }
  get ffa() { return this.mode === 'ffa' || this.mode === 'duel'; }
  get cfg() { return modeConfig(this.mode); }
  hostile(a, b) { return a !== b && (this.ffa || a.team !== b.team); }

  resetMatchState() {
    this.score = { T: 0, CT: 0 };
    this.lossStreak = { T: 0, CT: 0 };
    this.round = 0;
    this.nades = [];
    this.smokes = [];
    this.fires = [];
    this.puddles = [];
    this.noises = [];
    this.bomb = { state: 'none' };
    this.sightings = { T: null, CT: null };
    this.teamPlan = { T: 'A' };
    this.nadeId = 1;
    if (this.blocks) this.clearBlocks();
    this.blocks = new Map();
    this.blockId = this.blockId || 1;
  }

  destroy() { clearInterval(this.timer); }

  // ─── Networking helpers ─────────────────────────────────────
  send(p, msg) {
    if (p.ws && p.ws.readyState === 1) p.ws.send(JSON.stringify(msg));
  }

  broadcast(msg, except = null) {
    const data = JSON.stringify(msg);
    for (const p of this.players.values()) {
      if (p === except || !p.ws || p.ws.readyState !== 1) continue;
      p.ws.send(data);
    }
  }

  humans() { return [...this.players.values()].filter((p) => !p.bot); }
  teamPlayers(team) { return [...this.players.values()].filter((p) => p.team === team); }
  alive(team) { return this.teamPlayers(team).filter((p) => p.alive); }

  // ─── Player lifecycle ───────────────────────────────────────
  createPlayer(name, team, bot) {
    const p = {
      id: this.nextId++, name, team, bot, ws: null,
      alive: false, hp: 100, armor: 0, helmet: false, money: ECON.START,
      kills: 0, deaths: 0, assists: 0, mvps: 0, score: 0, roundKills: 0,
      body: newBody(), yaw: 0, pitch: 0, walk: false, scoped: 0,
      input: { wx: 0, wz: 0 },
      weapons: { primary: DEFAULT_PRIMARY, secondary: 'udder9', grenades: [], bomb: false, kit: false },
      ammo: {},
      loadout: { primary: null, secondary: null },
      active: DEFAULT_PRIMARY, lastShot: 0, reloadEnd: 0, recoilIndex: 0,
      history: [], use: false, useStart: null, usePos: null, blindUntil: 0,
      damageTo: new Map(), lastInput: nowMs(), fireAcc: 0, lastHurtBy: null, lastHurtT: 0,
      survived: false, ping: 0, spawnT: 0, respawnAt: 0, protectUntil: 0,
    };
    if (bot) p.brain = new BotBrain(this, p);
    this.players.set(p.id, p);
    return p;
  }

  addHuman(ws, name, wantTeam) {
    this.use();
    const team = this.ffa ? this.ffaTeam() : this.pickTeam(wantTeam);
    if (this.ffa) this.removeBotFFA();
    else this.removeBotFrom(team);
    const p = this.createPlayer(name, team, false);
    p.ws = ws;
    this.send(p, { t: 'welcome', id: p.id, room: this.name, st: nowMs(), map: MAP.name, mode: this.mode, code: this.name.toUpperCase(), priv: !!this.private });
    this.send(p, {
      t: 'state',
      smokes: this.smokes.map((s) => ({ id: s.id, p: [s.x, s.y, s.z], left: s.until - this.nowS })),
      fires: this.fires.map((f) => ({ id: f.id, p: [f.x, f.y, f.z], left: f.until - this.nowS })),
      puddles: this.puddles.map((f) => ({ p: [f.x, f.y, f.z], left: f.until - this.nowS })),
      blocks: [...this.blocks.values()].map((b) => [b.id, b.min[0], b.min[1], b.min[2], b.owner]),
    });
    if (this.phase === 'waiting') {
      this.ensureBots();
      this.startMatch();
    } else {
      this.ensureBots();
      if (this.phase === 'buy' || (this.ffa && this.phase === 'live')) this.spawn(p, true);
    }
    this.chatSystem(this.ffa ? `${name} joined the free-for-all` : `${name} joined the ${team === 'T' ? 'Rogue Bulls' : 'Dairy Guard'}`);
    this.sendRoster();
    return p;
  }

  ffaTeam() {
    return this.teamPlayers('T').length <= this.teamPlayers('CT').length ? 'T' : 'CT';
  }

  pickTeam(want) {
    const humans = (t) => this.teamPlayers(t).filter((p) => !p.bot).length;
    if (want === 'T' || want === 'CT') {
      if (humans(want) < TEAM_SIZE) return want;
      return want === 'T' ? 'CT' : 'T';
    }
    return humans('T') <= humans('CT') ? 'T' : 'CT';
  }

  removeBotFrom(team) {
    const bots = this.teamPlayers(team).filter((p) => p.bot);
    if (this.teamPlayers(team).length < TEAM_SIZE || !bots.length) return;
    const victim = bots.find((b) => !b.alive) || bots[bots.length - 1];
    this.removePlayer(victim, true);
  }

  removeBotFFA() {
    const bots = [...this.players.values()].filter((p) => p.bot);
    if (this.players.size < this.cfg.PLAYERS || !bots.length) return;
    this.removePlayer(bots.find((b) => !b.alive) || bots[bots.length - 1], true);
  }

  removePlayer(p, silent = false) {
    this.use();
    if (!this.players.has(p.id)) return;
    if (p.alive && p.weapons.bomb) this.dropBomb(p);
    this.players.delete(p.id);
    this.broadcast({ t: 'leave', id: p.id });
    if (!silent) this.chatSystem(`${p.name} left the game`);
    if (!p.bot) {
      if (this.humans().length === 0) {
        for (const b of [...this.players.values()]) this.players.delete(b.id);
        this.phase = 'waiting';
        this.resetMatchState();
        this.emptySince = nowMs();
      } else {
        this.ensureBots();
      }
    }
    this.sendRoster();
  }

  changeTeam(p, team) {
    if (this.ffa) return;
    if ((team !== 'T' && team !== 'CT') || team === p.team) return;
    if (this.teamPlayers(team).filter((q) => !q.bot).length >= TEAM_SIZE) return;
    if (p.alive) this.kill(p, null, 'suicide', false, false);
    this.removeBotFrom(team);
    p.team = team;
    p.survived = false;
    this.ensureBots();
    if (this.phase === 'buy') this.spawn(p, true);
    this.sendRoster();
    this.sendYou(p);
  }

  ensureBots() {
    const used = new Set([...this.players.values()].map((p) => p.name));
    const nextName = () => {
      const n = BOT_NAMES.find((x) => !used.has(x)) || `Cow ${this.nextId}`;
      used.add(n);
      return n;
    };
    if (this.ffa) {
      while (this.players.size < this.cfg.PLAYERS) {
        const b = this.createPlayer(nextName(), this.ffaTeam(), true);
        if (this.phase === 'buy' || this.phase === 'live') this.spawn(b, true);
      }
      const bots = [...this.players.values()].filter((p) => p.bot);
      while (this.players.size > this.cfg.PLAYERS && bots.length) this.removePlayer(bots.pop(), true);
      return;
    }
    for (const team of ['T', 'CT']) {
      while (this.teamPlayers(team).length < TEAM_SIZE) {
        const b = this.createPlayer(nextName(), team, true);
        if (this.phase === 'buy') this.spawn(b, true);
      }
      const bots = this.teamPlayers(team).filter((p) => p.bot);
      while (this.teamPlayers(team).length > TEAM_SIZE && bots.length) this.removePlayer(bots.pop(), true);
    }
  }

  // ─── Match flow ─────────────────────────────────────────────
  startMatch() {
    this.resetMatchState();
    for (const p of this.players.values()) {
      Object.assign(p, { kills: 0, deaths: 0, assists: 0, mvps: 0, score: 0, money: ECON.START, survived: false });
    }
    if (this.ffa) {
      this.round = 1;
      this.phase = 'buy';
      this.phaseEnd = this.nowS + this.cfg.WARMUP;
      this.nades = [];
      for (const p of this.players.values()) this.spawn(p, true);
      this.broadcast({ t: 'round', phase: 'buy', round: 1, score: this.score, mode: this.mode });
      for (const p of this.players.values()) this.sendYou(p);
      this.sendRoster();
      return;
    }
    this.startRound();
  }

  startRound() {
    this.round++;
    this.phase = 'buy';
    this.phaseEnd = this.nowS + ROUND.BUY_TIME;
    this.nades = [];
    this.smokes = [];
    this.fires = [];
    this.puddles = [];
    this.clearBlocks();
    this.planted = false;
    this.bomb = { state: 'none' };
    this.sightings = { T: null, CT: null };
    this.teamPlan = { T: Math.random() < 0.5 ? 'A' : 'B' };
    this.roundStart = this.nowS;

    for (const team of ['T', 'CT']) {
      const list = this.teamPlayers(team).sort(() => Math.random() - 0.5);
      list.forEach((p, i) => this.spawn(p, !p.survived, i));
      const bots = list.filter((p) => p.bot);
      const roles = ['A', 'B', 'mid', 'A', 'B'];
      bots.forEach((b, i) => b.brain.reset(roles[i % roles.length]));
    }
    const ts = this.alive('T');
    if (ts.length) {
      const carrier = ts[Math.floor(Math.random() * ts.length)];
      carrier.weapons.bomb = true;
      this.bomb = { state: 'carried', carrier: carrier.id };
    }
    this.broadcast({ t: 'round', phase: 'buy', round: this.round, score: this.score, mode: this.mode });
    for (const p of this.players.values()) this.sendYou(p);
    this.sendRoster();
  }

  pickFFASpawn(p) {
    const others = [...this.players.values()].filter((q) => q !== p && q.alive);
    const scored = MAP.spawns.FFA.map((s) => {
      let nearest = Infinity;
      let exposed = 0;
      for (const q of others) {
        const d = Math.hypot(q.body.x - s[0], q.body.z - s[1]);
        nearest = Math.min(nearest, d);
        // A spawn in an enemy's immediate line of sight is much easier to camp than
        // one behind cover, even when the straight-line distance is similar.
        if (d < 24 && lineClear([s[0], PLAYER.EYE, s[1]], this.eye(q))) exposed++;
      }
      return { s, nearest, exposed };
    }).sort((a, b) => b.nearest - a.nearest || a.exposed - b.exposed);
    const safest = scored.filter((x) => x.nearest >= 16 && x.exposed === scored[0].exposed);
    const pool = safest.length ? safest : scored.slice(0, Math.min(4, scored.length));
    return pool[Math.floor(Math.random() * Math.min(4, pool.length))].s;
  }

  spawn(p, resetGear, index) {
    let x, z, yaw;
    if (this.ffa) {
      [x, z] = this.pickFFASpawn(p);
      yaw = Math.atan2(x, z);
    } else {
      const spawns = MAP.spawns[p.team];
      if (index == null) index = this.teamPlayers(p.team).indexOf(p);
      [x, z] = spawns[index % spawns.length];
      yaw = MAP.spawnYaw[p.team];
    }
    p.body = newBody(x, 0, z);
    p.yaw = yaw;
    p.pitch = 0;
    p.alive = true;
    p.hp = 100;
    p.use = false; p.useStart = null;
    p.blindUntil = 0;
    p.reloadEnd = 0;
    p.recoilIndex = 0;
    p.scoped = 0;
    p.roundKills = 0;
    p.damageTo = new Map();
    p.history = [];
    p.spawnT = this.nowS;
    p.respawnAt = 0;
    p.protectUntil = this.ffa ? this.nowS + this.cfg.PROTECT : 0;
    p.weapons.bomb = false;
    p.blocksLeft = BLOCKS.PER_LIFE[this.mode] ?? 6;
    if (this.ffa) {
      p.armor = 100;
      p.helmet = true;
      p.weapons = { primary: p.loadout.primary || DEFAULT_PRIMARY, secondary: p.loadout.secondary || 'udder9', grenades: [], bomb: false, kit: false };
      p.ammo = {};
    } else if (resetGear) {
      p.armor = 0; p.helmet = false;
      p.weapons = { primary: DEFAULT_PRIMARY, secondary: 'udder9', grenades: [], bomb: false, kit: false };
      p.ammo = {};
    }
    if (p.team !== 'CT') p.weapons.kit = false;
    for (const id of [p.weapons.primary, p.weapons.secondary]) {
      if (id) p.ammo[id] = [WEAPONS[id].mag, WEAPONS[id].reserve];
    }
    p.active = p.weapons.primary || p.weapons.secondary;
    if (p.brain && this.ffa) p.brain.reset('ffa');
    this.send(p, { t: 'spawn', p: [x, 0, z], yaw });
    this.sendYou(p);
  }

  endRound(winner, reason) {
    if (this.phase !== 'live' || this.ffa) return;
    this.phase = 'end';
    this.phaseEnd = this.nowS + ROUND.END_TIME;
    const loser = winner === 'T' ? 'CT' : 'T';
    this.score[winner]++;
    this.lossStreak[winner] = 0;
    this.lossStreak[loser]++;

    for (const p of this.players.values()) {
      p.survived = p.alive;
      if (p.team === winner) p.money += ECON.WIN;
      else {
        p.money += lossBonus(this.lossStreak[loser]);
        if (p.team === 'T' && this.planted) p.money += ECON.PLANT_BONUS;
      }
      p.money = Math.min(ECON.MAX, p.money);
      p.use = false; p.useStart = null;
    }

    let mvp = null, mvpReason = '';
    if (reason === 'bomb' && this.bomb.planter) { mvp = this.players.get(this.bomb.planter); mvpReason = 'for planting the Sour Milk Bomb'; }
    if (reason === 'defuse' && this.bomb.defuser) { mvp = this.players.get(this.bomb.defuser); mvpReason = 'for defusing the bomb'; }
    if (!mvp) {
      const cands = this.teamPlayers(winner).sort((a, b) => b.roundKills - a.roundKills);
      if (cands[0] && cands[0].roundKills > 0) { mvp = cands[0]; mvpReason = 'for most eliminations'; }
    }
    if (mvp) { mvp.mvps++; mvp.score += 2; }

    const matchOver = this.score[winner] >= ROUND.WIN_ROUNDS;
    this.broadcast({
      t: 'roundEnd', w: winner, r: reason, score: this.score, round: this.round,
      mvp: mvp ? mvp.id : null, mvpName: mvp?.name, mvpReason, over: matchOver,
    });
    if (matchOver) {
      this.phase = 'over';
      this.phaseEnd = this.nowS + ROUND.MATCH_END_TIME;
      this.broadcast({ t: 'matchEnd', w: winner, score: this.score });
    }
    for (const p of this.players.values()) this.sendYou(p);
    this.sendRoster();
  }

  endFFA() {
    if (this.phase === 'over') return;
    const leader = [...this.players.values()].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths)[0];
    this.phase = 'over';
    this.phaseEnd = this.nowS + ROUND.MATCH_END_TIME;
    this.broadcast({ t: 'matchEnd', ffa: true, winner: leader?.name, id: leader?.id, kills: leader?.kills ?? 0, score: this.score });
    this.sendRoster();
  }

  halftime() {
    for (const p of this.players.values()) {
      p.team = p.team === 'T' ? 'CT' : 'T';
      p.money = ECON.START;
      p.survived = false;
    }
    this.score = { T: this.score.CT, CT: this.score.T };
    this.lossStreak = { T: 0, CT: 0 };
    this.broadcast({ t: 'half', score: this.score });
    this.chatSystem('HALFTIME — teams have switched sides');
  }

  // ─── Inputs from humans ─────────────────────────────────────
  handleMessage(p, msg) {
    this.use();
    switch (msg.t) {
      case 'in': return this.onInput(p, msg);
      case 'shoot': return this.onShoot(p, msg);
      case 'buy': return this.buy(p, msg.item) && this.sendYou(p);
      case 'switch': return this.switchWeapon(p, msg.w);
      case 'reload': return this.startReload(p);
      case 'throw': return this.onThrow(p, msg);
      case 'use': p.use = !!msg.on; return;
      case 'scope': p.scoped = msg.z | 0; return;
      case 'drop': if (p.alive && p.weapons.bomb && p.active === 'bomb') this.dropBomb(p, true); return;
      case 'team': return this.changeTeam(p, msg.team);
      case 'place': return this.placeBlock(p, msg);
      case 'breakBlock': return this.breakOwnBlock(p, msg);
      case 'stomp': return this.onStomp(p, msg);
      case 'chat': return this.onChat(p, msg);
      case 'ping': p.ping = msg.rtt | 0; return this.send(p, { t: 'pong', ts: msg.ts, st: nowMs() });
    }
  }

  onInput(p, m) {
    const t = nowMs();
    const dt = Math.min(1, (t - p.lastInput) / 1000);
    p.lastInput = t;
    if (typeof m.yaw === 'number') p.yaw = m.yaw;
    if (typeof m.pitch === 'number') p.pitch = Math.max(-1.55, Math.min(1.55, m.pitch));
    if (!p.alive || !Array.isArray(m.p)) return;
    const [x, y, z] = m.p.map(Number);
    if (![x, y, z].every(Number.isFinite)) return;
    const b = p.body;
    const frozen = this.phase === 'buy';
    const dist = Math.hypot(x - b.x, z - b.z);
    const allowed = frozen ? 0.25 : dt * PLAYER.SPEED * 1.8 + 0.6;
    const blocked = boxBlocked(x, y + 0.05, z, PLAYER.RADIUS - 0.08, playerHeight(m.c || 0) - 0.1);
    if (dist > allowed || Math.abs(y - b.y) > 3 || blocked) {
      this.send(p, { t: 'setpos', p: [b.x, b.y, b.z] });
      return;
    }
    b.x = x; b.y = y; b.z = z;
    if (Array.isArray(m.v)) { b.vx = +m.v[0] || 0; b.vy = +m.v[1] || 0; b.vz = +m.v[2] || 0; }
    b.crouch = Math.max(0, Math.min(1, +m.c || 0));
    b.onGround = !!m.g;
    p.walk = !!m.w;
  }

  onChat(p, m) {
    const msg = String(m.msg || '').slice(0, 140).trim();
    if (!msg) return;
    const teamOnly = !!m.team && !this.ffa;
    const payload = { t: 'chat', id: p.id, name: p.name, team: this.ffa ? 'FFA' : p.team, msg, teamOnly, dead: !p.alive };
    for (const q of this.players.values()) {
      if (teamOnly && q.team !== p.team) continue;
      this.send(q, payload);
    }
  }

  chatSystem(msg) {
    this.broadcast({ t: 'chat', system: true, msg });
  }

  // ─── Economy / loadout ──────────────────────────────────────
  canBuy(p) {
    if (!p.alive) return false;
    if (this.ffa) return this.phase === 'buy' || this.phase === 'live';
    const inTime = this.phase === 'buy' || (this.phase === 'live' && this.nowS - this.liveStart < 20);
    return inTime && inRect(MAP.buyZones[p.team], p.body.x, p.body.z);
  }

  buy(p, item) {
    if (!this.canBuy(p)) return false;
    const w = WEAPONS[item], eq = EQUIPMENT[item];
    const info = w || eq;
    if (!info) return false;
    if (!this.ffa && info.team !== 'any' && info.team !== p.team) return false;
    if (this.ffa && (item === 'kit' || item === 'bomb')) return false;
    let price = info.price;

    if (eq) {
      if (item === 'vest' && p.armor >= 100) return false;
      if (item === 'vesthelm') {
        if (p.armor >= 100 && p.helmet) return false;
        if (p.armor >= 100) price = 350;
      }
      if (item === 'kit' && p.weapons.kit) return false;
      if (p.money < price) return false;
      p.money -= price;
      if (item === 'vest') p.armor = 100;
      if (item === 'vesthelm') { p.armor = 100; p.helmet = true; }
      if (item === 'kit') p.weapons.kit = true;
      return true;
    }

    if (w.slot === 'grenade') {
      const g = p.weapons.grenades;
      if (g.length >= MAX_GRENADES || g.filter((x) => x === item).length >= w.max) return false;
      if (p.money < price) return false;
      p.money -= price;
      g.push(item);
      return true;
    }
    if (w.slot === 'primary' || w.slot === 'secondary') {
      if (p.weapons[w.slot] === item) return false;
      if (p.money < price) return false;
      p.money -= price;
      if (this.ffa) p.loadout[w.slot] = item; // bought guns stay with you across respawns
      p.weapons[w.slot] = item;
      p.ammo[item] = [w.mag, w.reserve];
      p.active = item;
      p.reloadEnd = 0;
      return true;
    }
    return false;
  }

  switchWeapon(p, id) {
    if (!p.alive || !this.hasWeapon(p, id) || p.active === id) return;
    p.active = id;
    p.reloadEnd = 0;
    p.scoped = 0;
    p.recoilIndex = 0;
    p.useStart = null;
  }

  hasWeapon(p, id) {
    const w = p.weapons;
    return id === 'hoof' || w.primary === id || w.secondary === id || w.grenades.includes(id) || (id === 'bomb' && w.bomb) || (id === 'cowblock' && p.blocksLeft > 0);
  }

  startReload(p) {
    const w = WEAPONS[p.active];
    const a = p.ammo[p.active];
    if (!p.alive || !a || p.reloadEnd || a[0] >= w.mag || a[1] <= 0) return;
    p.reloadEnd = this.nowS + (w.shellReload || w.reload);
    p.scoped = 0;
  }

  // ─── Combat ─────────────────────────────────────────────────
  eye(p) {
    return [p.body.x, p.body.y + eyeHeight(p.body.crouch), p.body.z];
  }

  rewind(q, tMs) {
    const h = q.history;
    if (!h.length) return [q.body.x, q.body.y, q.body.z, q.body.crouch];
    if (tMs >= h[h.length - 1].t) { const e = h[h.length - 1]; return [e.x, e.y, e.z, e.c]; }
    for (let i = h.length - 1; i > 0; i--) {
      const a = h[i - 1], b = h[i];
      if (tMs >= a.t) {
        const k = (tMs - a.t) / Math.max(1, b.t - a.t);
        return [a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, a.z + (b.z - a.z) * k, a.c + (b.c - a.c) * k];
      }
    }
    const e = h[0];
    return [e.x, e.y, e.z, e.c];
  }

  onShoot(p, m) {
    if (!p.alive || !Array.isArray(m.d)) return;
    const w = WEAPONS[p.active];
    if (!w || m.w !== p.active) return;
    let origin = this.eye(p);
    if (Array.isArray(m.o) && m.o.length === 3) {
      const o = m.o.map(Number);
      if (o.every(Number.isFinite) && Math.hypot(o[0] - origin[0], o[1] - origin[1], o[2] - origin[2]) < 1.2) origin = o;
    }
    const dirs = m.d.slice(0, w.pellets || 1).map((d) => {
      const v = (Array.isArray(d) ? d : []).map(Number);
      const l = Math.hypot(v[0], v[1], v[2]) || 1;
      return [v[0] / l, v[1] / l, v[2] / l];
    }).filter((d) => d.every(Number.isFinite));
    if (!dirs.length) return;
    const now = nowMs();
    const rt = Math.max(now - LAG_COMP_MAX, Math.min(now, Number(m.rt) || now));
    const claims = Array.isArray(m.h) ? m.h : [];
    this.fireWeapon(p, origin, dirs, rt, { alt: !!m.alt, claims });
  }

  /** Bots: shoot along current aim with spread + (partially compensated) recoil. */
  botShoot(p) {
    const w = WEAPONS[p.active];
    if (!w || w.slot === 'grenade' || w.slot === 'bomb') return false;
    if (w.slot === 'melee') return this.fireWeapon(p, this.eye(p), [dirFromAngles(p.yaw, p.pitch)], nowMs(), {});
    const spread = computeSpread(p.body, w, p.scoped > 0) * (this.ffa ? 2.35 : 1);
    const rec = RECOIL[w.recoil] || RECOIL.none;
    const [ry, rp] = rec[Math.min(Math.floor(p.recoilIndex), rec.length - 1)];
    const comp = this.ffa ? 0.18 : 0.6;
    const dirs = [];
    for (let i = 0; i < (w.pellets || 1); i++) dirs.push(shotDirection(p.yaw, p.pitch, spread, ry * (1 - comp), rp * (1 - comp)));
    const ok = this.fireWeapon(p, this.eye(p), dirs, nowMs(), {});
    if (ok) p.recoilIndex++;
    return ok;
  }

  fireWeapon(p, origin, dirs, rewindT, opts) {
    if (this.phase === 'buy' || this.phase === 'waiting' || this.phase === 'over') return false;
    const w = WEAPONS[p.active];
    const nowS = this.nowS;
    if (w.slot === 'melee') {
      const interval = opts.alt ? 1.0 : 0.45;
      if (nowS - p.lastShot < interval * 0.8) return false;
      p.lastShot = nowS;
      p.protectUntil = 0;
      this.knife(p, origin, dirs[0], rewindT, opts.alt);
      return true;
    }
    if (w.slot !== 'primary' && w.slot !== 'secondary') return false;
    const ammo = p.ammo[p.active];
    if (p.reloadEnd && w.shellReload && ammo && ammo[0] > 0) p.reloadEnd = 0; // firing interrupts a shell-by-shell reload
    if (!ammo || ammo[0] <= 0 || p.reloadEnd) return false;
    const interval = 60 / w.rpm;
    if (nowS - p.lastShot < interval * (p.bot ? 1 : 0.7)) return false;
    ammo[0]--;
    p.lastShot = nowS;
    p.protectUntil = 0;

    const ends = [];
    const impacts = [];
    dirs.forEach((d, i) => {
      const res = this.traceBullet(p, origin, d, w, rewindT, opts.claims?.[i]);
      ends.push(res.end.map(r2));
      if (res.impact) impacts.push(res.impact);
    });
    if (w.slick) for (const im of impacts) this.addPuddle(im);
    this.broadcast({ t: 'shot', id: p.id, w: w.id, o: origin.map(r2), e: ends }, p.bot ? null : p);
    this.noises.push({ x: p.body.x, z: p.body.z, t: nowS, team: p.team, id: p.id, loud: !w.suppressed });
    if (ammo[0] <= 0 && ammo[1] > 0 && p.bot) this.startReload(p);
    return true;
  }

  /** Validate a client-side hit claim against the rewound target; returns a result or null. */
  checkClaim(p, o, d, w, rewindT, claim, worldEvents) {
    if (!claim || typeof claim !== 'object') return null;
    const q = this.players.get(Number(claim.id));
    if (!q || !q.alive || !this.hostile(p, q)) return null;
    const [x, y, z, c] = this.rewind(q, rewindT);
    const h = playerHeight(c);
    const center = [x, y + h * 0.55, z];
    const t = (center[0] - o[0]) * d[0] + (center[1] - o[1]) * d[1] + (center[2] - o[2]) * d[2];
    if (t <= 0 || t > w.range) return null;
    const px = o[0] + d[0] * t - center[0], py = o[1] + d[1] * t - center[1], pz = o[2] + d[2] * t - center[2];
    if (Math.hypot(px, py, pz) > 1.15) return null;
    let mult = 1, pens = w.penetration || 0, wallbang = false;
    for (const ev of worldEvents) {
      if (ev.t >= t - 0.5) break;
      if (ev.penetrable && pens > 0 && ev.tOut - ev.t < 1.6) { pens--; mult *= 0.5; wallbang = true; continue; }
      return null;
    }
    let group = claim.g === 'head' || claim.g === 'leg' ? claim.g : 'body';
    if (group === 'head') {
      const hc = [x, y + h - 0.2, z];
      const th = (hc[0] - o[0]) * d[0] + (hc[1] - o[1]) * d[1] + (hc[2] - o[2]) * d[2];
      const hx = o[0] + d[0] * th - hc[0], hy = o[1] + d[1] * th - hc[1], hz = o[2] + d[2] * th - hc[2];
      if (Math.hypot(hx, hy, hz) > 0.7) group = 'body';
    }
    return { q, t, group, mult, wallbang };
  }

  traceBullet(p, o, d, w, rewindT, claim) {
    const range = w.range;
    const worldEvents = raycastAll(o, d, range);
    const ok = this.checkClaim(p, o, d, w, rewindT, claim, worldEvents);
    if (ok) {
      const raw = w.damage[ok.group] * rangeFalloff(w, ok.t) * ok.mult;
      this.damage(ok.q, p, raw, ok.group, w, { wallbang: ok.wallbang, from: o });
      return { end: [o[0] + d[0] * ok.t, o[1] + d[1] * ok.t, o[2] + d[2] * ok.t], impact: null };
    }
    const events = worldEvents.map((h) => ({ ...h, kind: 'world' }));
    for (const q of this.players.values()) {
      if (q === p || !q.alive || !this.hostile(p, q)) continue;
      const [x, y, z, c] = this.rewind(q, rewindT);
      const hit = rayPlayer(o, d, [x, y, z], c);
      if (hit && hit.t <= range) events.push({ t: hit.t, kind: 'player', q, group: hit.group });
    }
    events.sort((a, b) => a.t - b.t);
    let mult = 1;
    let pens = w.penetration || 0;
    let wallbang = false;
    let endT = range;
    let impact = null;
    for (const ev of events) {
      if (ev.kind === 'world') {
        const thick = ev.tOut - ev.t;
        if (ev.penetrable && pens > 0 && thick < 1.6) {
          pens--;
          mult *= 0.5;
          wallbang = true;
          continue;
        }
        endT = ev.t;
        impact = { p: [o[0] + d[0] * ev.t, o[1] + d[1] * ev.t, o[2] + d[2] * ev.t], n: ev.normal };
        if (ev.box?.dyn) this.damageBlock(ev.box, (w.damage?.body || 30) * mult, p);
        break;
      }
      const raw = w.damage[ev.group] * rangeFalloff(w, ev.t) * mult;
      this.damage(ev.q, p, raw, ev.group, w, { wallbang, from: o });
      endT = ev.t;
      break;
    }
    return { end: [o[0] + d[0] * endT, o[1] + d[1] * endT, o[2] + d[2] * endT], impact };
  }

  knife(p, o, d, rewindT, alt) {
    let best = null;
    for (const q of this.players.values()) {
      if (q === p || !q.alive || !this.hostile(p, q)) continue;
      const [x, y, z, c] = this.rewind(q, rewindT);
      const hit = rayPlayer(o, d, [x, y, z], c);
      let t = hit?.t;
      if (t == null) {
        const dx = x - o[0], dz = z - o[2];
        const dist = Math.hypot(dx, dz);
        if (dist < 1.5 && (dx * d[0] + dz * d[2]) / (dist || 1) > 0.7) t = dist;
      }
      if (t != null && t <= WEAPONS.hoof.range + 0.2 && (!best || t < best.t)) best = { q, t, group: hit?.group || 'body' };
    }
    this.broadcast({ t: 'swing', id: p.id, alt, hit: !!best }, p.bot ? null : p);
    if (!best) return;
    const q = best.q;
    const view = dirFromAngles(q.yaw, 0);
    const toVictim = [q.body.x - p.body.x, q.body.z - p.body.z];
    const l = Math.hypot(...toVictim) || 1;
    const backstab = (view[0] * toVictim[0] + view[2] * toVictim[1]) / l > 0.5;
    const raw = alt ? (backstab ? 180 : 65) : (backstab ? 90 : 40);
    this.damage(q, p, raw, 'body', WEAPONS.hoof, { from: o });
  }

  damage(victim, attacker, raw, group, w, opts = {}) {
    if (!victim.alive) return;
    if (attacker && attacker !== victim && victim.protectUntil > this.nowS) return;
    const pen = w?.armorPen ?? 0.5;
    const effGroup = group === 'fire' ? 'none' : group;
    const { health, armorLoss } = armorDamage(raw, effGroup, victim.armor, victim.helmet, pen);
    const dmg = Math.max(1, Math.round(health));
    victim.armor = Math.max(0, Math.round(victim.armor - armorLoss));
    const actual = Math.min(dmg, victim.hp);
    victim.hp -= dmg;
    victim.lastDamageT = this.nowS;
    if (attacker) {
      victim.lastHurtBy = attacker.id;
      victim.lastHurtT = this.nowS;
      if (attacker !== victim) attacker.damageTo.set(victim.id, (attacker.damageTo.get(victim.id) || 0) + actual);
      this.send(attacker, { t: 'hit', v: victim.id, d: actual, g: group, k: victim.hp <= 0 });
    }
    this.send(victim, { t: 'hurt', d: actual, from: opts.from ? opts.from.map(r2) : null, g: group, hp: Math.max(0, victim.hp) });
    if (victim.brain) victim.brain.onHurt(attacker);
    if (victim.hp <= 0) {
      victim.hp = 0;
      this.kill(victim, attacker, w?.id || group, group === 'head', !!opts.wallbang);
    }
  }

  kill(victim, killer, weapon, headshot, wallbang) {
    victim.alive = false;
    victim.deaths++;
    victim.use = false; victim.useStart = null;
    if (victim.weapons.bomb) this.dropBomb(victim);
    let assister = null;
    for (const q of this.players.values()) {
      if (q === killer || q === victim || !this.hostile(q, victim)) continue;
      if ((q.damageTo.get(victim.id) || 0) >= 40) { q.assists++; q.score++; assister = q; }
    }
    if (killer && killer !== victim) {
      if (!this.hostile(killer, victim)) {
        killer.kills--;
        killer.money = Math.max(0, killer.money + ECON.TEAMKILL_PENALTY);
      } else {
        killer.kills++;
        killer.roundKills++;
        killer.score += 2;
        const reward = WEAPONS[weapon]?.killReward ?? 300;
        killer.money = Math.min(ECON.MAX, killer.money + reward);
        this.send(killer, { t: 'reward', amount: reward, reason: 'kill' });
      }
    }
    if (this.ffa) victim.respawnAt = this.nowS + this.cfg.RESPAWN;
    this.broadcast({
      t: 'kill', k: killer?.id ?? null, v: victim.id, w: weapon, hs: headshot, wb: wallbang,
      a: assister?.id ?? null, p: [victim.body.x, victim.body.y, victim.body.z].map(r2), yaw: victim.yaw,
    });
    this.sendYou(victim);
    if (killer) this.sendYou(killer);
    this.sendRoster();
    if (this.ffa && killer && killer.kills >= this.cfg.FRAG_LIMIT) this.endFFA();
  }

  // ─── Grenades ───────────────────────────────────────────────
  onThrow(p, m) {
    if (!p.alive || this.phase === 'buy' || this.phase === 'waiting') return;
    const g = m.g;
    if (!GRENADE_IDS.includes(g) || !p.weapons.grenades.includes(g)) return;
    const eye = this.eye(p);
    const v = (Array.isArray(m.v) ? m.v : [0, 0, 0]).map(Number);
    if (!v.every(Number.isFinite)) return;
    const sp = Math.hypot(...v);
    if (sp > 24) { v[0] *= 24 / sp; v[1] *= 24 / sp; v[2] *= 24 / sp; }
    this.throwGrenade(p, g, eye, v);
  }

  throwGrenade(p, g, origin, v) {
    const idx = p.weapons.grenades.indexOf(g);
    if (idx < 0) return false;
    p.weapons.grenades.splice(idx, 1);
    p.protectUntil = 0;
    const n = {
      id: this.nadeId++, type: g, owner: p.id, team: p.team,
      x: origin[0], y: origin[1], z: origin[2], vx: v[0], vy: v[1], vz: v[2],
      born: this.nowS, fuse: WEAPONS[g].fuse, still: 0,
    };
    this.nades.push(n);
    if (p.active === g) {
      p.active = p.weapons.grenades.includes(g) ? g : (p.weapons.grenades[0] || p.weapons.primary || p.weapons.secondary || 'hoof');
    }
    this.broadcast({ t: 'throw', id: p.id, n: n.id, g });
    this.sendYou(p);
    return true;
  }

  pointSolid(x, y, z) {
    if (y < 0.06) return true;
    for (const b of MAP.boxes) {
      if (x > b.min[0] - 0.06 && x < b.max[0] + 0.06 && y > b.min[1] - 0.06 && y < b.max[1] + 0.06 && z > b.min[2] - 0.06 && z < b.max[2] + 0.06) return true;
    }
    return false;
  }

  updateNades(dt) {
    const keep = [];
    for (const n of this.nades) {
      n.vy -= PLAYER.GRAVITY * 0.9 * dt;
      let landed = false;
      const steps = 3;
      const sdt = dt / steps;
      for (let s = 0; s < steps; s++) {
        const nx = n.x + n.vx * sdt;
        if (this.pointSolid(nx, n.y, n.z)) { n.vx *= -0.45; n.vy *= 0.85; n.vz *= 0.85; } else n.x = nx;
        const nz = n.z + n.vz * sdt;
        if (this.pointSolid(n.x, n.y, nz)) { n.vz *= -0.45; n.vx *= 0.85; n.vy *= 0.85; } else n.z = nz;
        const ny = n.y + n.vy * sdt;
        if (this.pointSolid(n.x, ny, n.z)) {
          if (n.vy < 0) landed = true;
          n.vy *= -0.38; n.vx *= 0.7; n.vz *= 0.7;
          if (Math.abs(n.vy) < 0.6) n.vy = 0;
        } else n.y = ny;
      }
      const age = this.nowS - n.born;
      const speed = Math.hypot(n.vx, n.vy, n.vz);
      let boom = false;
      if (n.type === 'molotov') boom = (landed && age > 0.15) || age >= n.fuse;
      else if (n.type === 'smoke') boom = (speed < 0.4 && age > 1) || age >= n.fuse;
      else boom = age >= n.fuse;
      if (boom) this.detonate(n);
      else keep.push(n);
    }
    this.nades = keep;
  }

  groundBelow(x, y, z) {
    const hit = raycastWorld([x, y + 0.1, z], [0, -1, 0], 50);
    return hit ? y + 0.1 - hit.t : 0;
  }

  detonate(n) {
    const pos = [n.x, n.y, n.z];
    const owner = this.players.get(n.owner);
    const nowS = this.nowS;
    if (n.type === 'butter') {
      for (const q of this.players.values()) {
        if (!q.alive) continue;
        const eye = this.eye(q);
        const dx = pos[0] - eye[0], dy = pos[1] - eye[1], dz = pos[2] - eye[2];
        const dist = Math.hypot(dx, dy, dz);
        if (dist > UTIL.FLASH_RANGE || !lineClear(pos, eye)) continue;
        if (this.smokeBlocks(pos, eye)) continue;
        const view = dirFromAngles(q.yaw, q.pitch);
        const dot = (view[0] * dx + view[1] * dy + view[2] * dz) / (dist || 1);
        const facing = dot > 0.55 ? 1 : dot > 0 ? 0.55 : 0.18;
        const distF = 1 - Math.pow(dist / UTIL.FLASH_RANGE, 2) * 0.75;
        const dur = UTIL.FLASH_MAX * facing * distF;
        if (dur < 0.25) continue;
        q.blindUntil = Math.max(q.blindUntil, nowS + dur);
        this.send(q, { t: 'flash', d: dur, full: facing === 1 });
        if (owner && this.hostile(owner, q)) this.send(owner, { t: 'flashed', v: q.id, d: dur });
      }
    } else if (n.type === 'he') {
      for (const q of this.players.values()) {
        if (!q.alive) continue;
        if (owner && q !== owner && !this.hostile(owner, q)) continue;
        const chest = [q.body.x, q.body.y + 1.0, q.body.z];
        const dist = Math.hypot(chest[0] - pos[0], chest[1] - pos[1], chest[2] - pos[2]);
        if (dist > UTIL.HE_RADIUS || !lineClear([pos[0], pos[1] + 0.2, pos[2]], chest)) continue;
        const raw = UTIL.HE_DAMAGE * Math.pow(1 - dist / UTIL.HE_RADIUS, 1.25);
        if (raw >= 1) this.damage(q, owner, raw, 'generic', { id: 'he', armorPen: 0.5 }, { from: pos });
      }
      for (const b of [...this.blocks.values()]) {
        const dist = Math.hypot(b.min[0] + 0.5 - pos[0], b.min[1] + 0.5 - pos[1], b.min[2] + 0.5 - pos[2]);
        if (dist < UTIL.HE_RADIUS) this.damageBlock(b, 160 * (1 - dist / UTIL.HE_RADIUS), owner);
      }
    } else if (n.type === 'smoke') {
      const s = { id: n.id, x: n.x, y: this.groundBelow(n.x, n.y, n.z), z: n.z, until: nowS + UTIL.SMOKE_DURATION, born: nowS };
      this.smokes.push(s);
      this.fires = this.fires.filter((f) => {
        const hit = Math.hypot(f.x - s.x, f.z - s.z) < UTIL.SMOKE_RADIUS + UTIL.FIRE_RADIUS * 0.5;
        if (hit) this.broadcast({ t: 'fireOut', id: f.id });
        return !hit;
      });
      pos[1] = s.y;
    } else if (n.type === 'molotov') {
      const gy = this.groundBelow(n.x, n.y, n.z);
      pos[1] = gy;
      const smoked = this.smokes.some((s) => Math.hypot(s.x - n.x, s.z - n.z) < UTIL.SMOKE_RADIUS);
      if (smoked) {
        this.broadcast({ t: 'boom', g: 'fizzle', p: pos.map(r2), id: n.id });
        return;
      }
      this.fires.push({ id: n.id, x: n.x, y: gy, z: n.z, until: nowS + UTIL.FIRE_DURATION, owner: n.owner, team: n.team });
    }
    this.broadcast({ t: 'boom', g: n.type, p: pos.map(r2), id: n.id });
    this.noises.push({ x: n.x, z: n.z, t: nowS, team: n.team, id: n.owner, loud: true });
  }

  smokeBlocks(a, b) {
    for (const s of this.smokes) {
      if (this.nowS - s.born < 0.8) continue;
      if (segmentSphere(a, b, [s.x, s.y + 1.6, s.z], UTIL.SMOKE_RADIUS)) return true;
    }
    return false;
  }

  canSee(a, b) {
    return lineClear(a, b) && !this.smokeBlocks(a, b);
  }

  inFire(x, y, z) {
    return this.fires.some((f) => Math.hypot(f.x - x, f.z - z) < UTIL.FIRE_RADIUS && Math.abs(y - f.y) < 1.2);
  }

  addPuddle(im) {
    let [x, y, z] = im.p;
    if (im.n[1] < 0.5) {
      x += im.n[0] * 0.3; z += im.n[2] * 0.3;
      y = this.groundBelow(x, y, z);
    }
    this.puddles.push({ x, y, z, until: this.nowS + UTIL.PUDDLE_DURATION });
    this.broadcast({ t: 'puddle', p: [x, y, z].map(r2), left: UTIL.PUDDLE_DURATION });
  }

  // ─── Cow blocks ─────────────────────────────────────────────
  placeBlock(p, msg) {
    if (!p.alive || this.phase === 'waiting' || this.phase === 'over' || !(p.blocksLeft > 0)) return;
    if (this.nowS - (p.lastPlace || 0) < BLOCKS.COOLDOWN) return;
    const c = Array.isArray(msg.c) ? msg.c.map(Number) : [];
    if (c.length !== 3 || !c.every(Number.isInteger)) return;
    const [x, y, z] = c;
    const B = MAP.bounds;
    if (y < 0 || y > BLOCKS.MAX_HEIGHT || x < B.minX || x + 1 > B.maxX || z < B.minZ || z + 1 > B.maxZ) return;
    const eye = this.eye(p);
    if (Math.hypot(x + 0.5 - eye[0], y + 0.5 - eye[1], z + 0.5 - eye[2]) > BLOCKS.REACH + 1.2) return;
    const min = [x, y, z], max = [x + 1, y + 1, z + 1];
    const E = 0.01;
    let supported = y === 0;
    const boxes = this.mapObj.boxes;
    for (const b of boxes) {
      if (max[0] - E > b.min[0] && min[0] + E < b.max[0] && max[1] - E > b.min[1] && min[1] + E < b.max[1] && max[2] - E > b.min[2] && min[2] + E < b.max[2]) return;
      if (!supported && max[0] + E > b.min[0] && min[0] - E < b.max[0] && max[1] + E > b.min[1] && min[1] - E < b.max[1] && max[2] + E > b.min[2] && min[2] - E < b.max[2]) supported = true;
    }
    if (!supported) return;
    for (const q of this.players.values()) {
      if (!q.alive) continue;
      const qb = q.body, h = playerHeight(qb.crouch), r = PLAYER.RADIUS;
      if (max[0] > qb.x - r && min[0] < qb.x + r && max[1] > qb.y && min[1] < qb.y + h && max[2] > qb.z - r && min[2] < qb.z + r) return;
    }
    const block = { min, max, mat: 'cowblock', dyn: true, id: this.blockId++, owner: p.id, hp: BLOCKS.HP, born: this.nowS };
    boxes.push(block);
    this.blocks.set(block.id, block);
    p.blocksLeft--;
    p.lastPlace = this.nowS;
    if (p.blocksLeft <= 0 && p.active === 'cowblock') p.active = p.weapons.primary || p.weapons.secondary || 'hoof';
    this.broadcast({ t: 'block', op: 'add', id: block.id, c: min, owner: p.id });
    this.sendYou(p);
  }

  breakOwnBlock(p, msg) {
    const b = this.blocks.get(Number(msg.id));
    if (!p.alive || !b || b.owner !== p.id) return;
    const eye = this.eye(p);
    if (Math.hypot(b.min[0] + 0.5 - eye[0], b.min[1] + 0.5 - eye[1], b.min[2] + 0.5 - eye[2]) > BLOCKS.REACH + 1.5) return;
    this.removeBlock(b.id, p.id);
    p.blocksLeft = (p.blocksLeft || 0) + 1;
    this.sendYou(p);
  }

  damageBlock(b, amount, by) {
    if (!this.blocks.has(b.id)) return;
    b.hp -= amount;
    if (b.hp <= 0) this.removeBlock(b.id, by?.id ?? null);
  }

  removeBlock(id, by = null) {
    const b = this.blocks.get(id);
    if (!b) return;
    this.blocks.delete(id);
    const i = this.mapObj.boxes.indexOf(b);
    if (i >= 0) this.mapObj.boxes.splice(i, 1);
    this.broadcast({ t: 'block', op: 'del', id, by });
  }

  clearBlocks() {
    if (!this.blocks?.size) return;
    const boxes = this.mapObj.boxes;
    for (const b of this.blocks.values()) {
      const i = boxes.indexOf(b);
      if (i >= 0) boxes.splice(i, 1);
    }
    this.blocks.clear();
    this.broadcast({ t: 'block', op: 'clear' });
  }

  expireBlocks() {
    for (const b of [...this.blocks.values()]) if (this.nowS - b.born > BLOCKS.LIFETIME) this.removeBlock(b.id);
  }

  /** Landing on an enemy's head. The client reports it; the server checks the rewound positions. */
  onStomp(p, msg) {
    if (!p.alive || this.phase !== 'live') return;
    const q = this.players.get(Number(msg.id));
    if (!q || !q.alive || !this.hostile(p, q)) return;
    if (this.nowS - (p.lastStomp || 0) < 0.6 || !(Number(msg.vy) < -3)) return;
    const now = nowMs();
    const rt = Math.max(now - LAG_COMP_MAX, Math.min(now, Number(msg.rt) || now));
    const [x, y, z, c] = this.rewind(q, rt);
    const top = y + playerHeight(c);
    const b = p.body;
    if (Math.hypot(b.x - x, b.z - z) > 1.1 || b.y < top - 1.0 || b.y > top + 1.2) return;
    p.lastStomp = this.nowS;
    p.protectUntil = 0;
    this.broadcast({ t: 'stomp', id: p.id, v: q.id, p: [x, top, z].map(r2) });
    this.damage(q, p, 150, 'head', WEAPONS.stomp, { from: [b.x, b.y, b.z] });
  }

  // ─── Bomb (defusal only) ────────────────────────────────────
  dropBomb(p, thrown = false) {
    p.weapons.bomb = false;
    if (p.active === 'bomb') p.active = p.weapons.primary || p.weapons.secondary || 'hoof';
    const f = thrown ? dirFromAngles(p.yaw, 0) : [0, 0, 0];
    let x = p.body.x + f[0] * 1.5, z = p.body.z + f[2] * 1.5;
    if (!this.nav.walkableAt(x, z)) { x = p.body.x; z = p.body.z; }
    const y = this.groundBelow(x, p.body.y + 0.5, z);
    this.bomb = { state: 'dropped', pos: [x, y, z], dropper: p.id, dropT: this.nowS };
    this.broadcast({ t: 'bomb', s: 'dropped', p: this.bomb.pos.map(r2) });
    this.sendYou(p);
  }

  updateBomb() {
    if (this.ffa) return;
    const b = this.bomb;
    const nowS = this.nowS;
    if (b.state === 'dropped') {
      for (const p of this.alive('T')) {
        if (p.id === b.dropper && nowS - b.dropT < 1.5) continue;
        if (Math.hypot(p.body.x - b.pos[0], p.body.z - b.pos[2]) < 1.3 && Math.abs(p.body.y - b.pos[1]) < 1.5) {
          p.weapons.bomb = true;
          this.bomb = { state: 'carried', carrier: p.id };
          this.broadcast({ t: 'bomb', s: 'picked', id: p.id });
          this.sendYou(p);
          break;
        }
      }
    }

    for (const p of this.players.values()) {
      if (!p.alive || this.phase !== 'live') { p.useStart = null; continue; }
      const body = p.body;
      let kind = null;
      if (p.team === 'T' && p.weapons.bomb && siteAt(body.x, body.z) && body.onGround && p.use) kind = 'plant';
      if (p.team === 'CT' && this.bomb.state === 'planted' && p.use && Math.hypot(body.x - this.bomb.pos[0], body.z - this.bomb.pos[2]) < 2 && Math.abs(body.y - this.bomb.pos[1]) < 1.6) kind = 'defuse';
      if (!kind) { if (p.useStart) { p.useStart = null; this.sendYou(p); } continue; }
      if (!p.useStart || p.useKind !== kind) {
        p.useStart = nowS; p.useKind = kind; p.usePos = [body.x, body.z];
        if (kind === 'defuse') this.broadcast({ t: 'bomb', s: 'defusing', id: p.id, kit: p.weapons.kit });
        if (kind === 'plant') this.broadcast({ t: 'bomb', s: 'planting', id: p.id });
        this.sendYou(p);
      }
      if (Math.hypot(body.x - p.usePos[0], body.z - p.usePos[1]) > 0.5) { p.useStart = null; continue; }
      const need = kind === 'plant' ? ROUND.PLANT_TIME : (p.weapons.kit ? ROUND.DEFUSE_TIME_KIT : ROUND.DEFUSE_TIME);
      if (nowS - p.useStart >= need) {
        p.useStart = null;
        p.use = false;
        if (kind === 'plant') this.plant(p);
        else this.defuse(p);
      }
    }

    if (this.bomb.state === 'planted' && this.phase === 'live' && nowS >= this.bomb.explodeAt) this.explode();
  }

  plant(p) {
    const body = p.body;
    p.weapons.bomb = false;
    if (p.active === 'bomb') p.active = p.weapons.primary || p.weapons.secondary || 'hoof';
    const site = siteAt(body.x, body.z);
    this.bomb = { state: 'planted', pos: [body.x, body.y, body.z], site, explodeAt: this.nowS + ROUND.BOMB_TIMER, planter: p.id };
    this.planted = true;
    p.money = Math.min(ECON.MAX, p.money + ECON.PLANT_REWARD);
    p.score += 2;
    this.broadcast({ t: 'bomb', s: 'planted', p: this.bomb.pos.map(r2), site, id: p.id, timer: ROUND.BOMB_TIMER });
    this.sendYou(p);
  }

  defuse(p) {
    this.bomb.state = 'defused';
    this.bomb.defuser = p.id;
    p.money = Math.min(ECON.MAX, p.money + ECON.DEFUSE_REWARD);
    p.score += 2;
    this.broadcast({ t: 'bomb', s: 'defused', id: p.id });
    this.endRound('CT', 'defuse');
  }

  explode() {
    const b = this.bomb;
    b.state = 'exploded';
    this.broadcast({ t: 'bomb', s: 'exploded', p: b.pos.map(r2) });
    for (const q of this.players.values()) {
      if (!q.alive) continue;
      const d = Math.hypot(q.body.x - b.pos[0], q.body.y - b.pos[1], q.body.z - b.pos[2]);
      if (d > UTIL.BOMB_RADIUS) continue;
      const sigma = UTIL.BOMB_RADIUS / 3;
      const raw = UTIL.BOMB_DAMAGE * Math.exp(-(d * d) / (2 * sigma * sigma));
      if (raw >= 1) this.damage(q, null, raw, 'generic', { id: 'bomb', armorPen: 0.5 }, { from: b.pos });
    }
    this.endRound('T', 'bomb');
  }

  reportSighting(team, pos) {
    if (this.ffa) return;
    let site = siteAt(pos[0], pos[2]);
    if (!site) {
      for (const s of Object.values(MAP.sites)) {
        if (Math.hypot(s.center[0] - pos[0], s.center[1] - pos[2]) < 26) site = s.name;
      }
    }
    this.sightings[team] = { site, pos, t: this.nowS };
  }

  // ─── Main loop ──────────────────────────────────────────────
  tick() {
    const t = nowMs();
    const dt = Math.min(0.1, (t - this.lastTick) / 1000);
    this.lastTick = t;
    this.nowS = t / 1000;
    this.tickCount++;
    if (this.phase === 'waiting') return;
    this.use();

    this.updatePhase();

    for (const p of this.players.values()) {
      if (this.ffa && !p.alive && p.respawnAt && this.nowS >= p.respawnAt && this.phase === 'live') this.spawn(p, true);
    }

    for (const p of this.players.values()) {
      if (!p.bot || !p.alive) continue;
      p.brain.update(dt);
      if (this.phase === 'buy') continue;
      const w = WEAPONS[p.active] || WEAPONS.hoof;
      let speedMult = w.speedMult || 1;
      if (p.scoped && w.scopedSpeedMult) speedMult = w.scopedSpeedMult;
      const inp = p.input;
      if (p.useStart) { inp.wx = 0; inp.wz = 0; }
      stepBody(p.body, { ...inp, speedMult, slow: this.inFire(p.body.x, p.body.y, p.body.z) }, dt);
    }

    for (const p of this.players.values()) {
      if (!p.alive) continue;
      p.history.push({ t, x: p.body.x, y: p.body.y, z: p.body.z, c: p.body.crouch });
      while (p.history.length && t - p.history[0].t > LAG_COMP_MAX + 100) p.history.shift();
      if (p.reloadEnd && this.nowS >= p.reloadEnd) {
        const w = WEAPONS[p.active];
        const a = p.ammo[p.active];
        // Reloading still takes time, but the reserve is bottomless.
        if (a && w && w.shellReload) {
          a[0] = Math.min(w.mag, a[0] + 1);
          a[1] = w.reserve;
          p.reloadEnd = a[0] < w.mag ? this.nowS + w.shellReload : 0;
        } else {
          if (a && w) { a[0] = w.mag; a[1] = w.reserve; }
          p.reloadEnd = 0;
        }
        this.sendYou(p);
      }
      if (p.hp < 100 && this.nowS - (p.lastDamageT || 0) > REGEN.DELAY) {
        p.regenAcc = (p.regenAcc || 0) + REGEN.RATE * dt;
        if (p.regenAcc >= 1) {
          const add = Math.floor(p.regenAcc);
          p.regenAcc -= add;
          p.hp = Math.min(100, p.hp + add);
        }
      }
      const w = WEAPONS[p.active];
      if (w && w.recovery && this.nowS - p.lastShot > (60 / w.rpm) * 1.3) {
        p.recoilIndex = Math.max(0, p.recoilIndex - w.recovery * dt);
      }
    }

    this.updateNades(dt);
    this.updateUtility(dt);
    this.updateBomb();
    this.checkRoundEnd();

    if (this.tickCount % Math.round(TICK_RATE / SNAPSHOT_RATE) === 0) this.sendSnapshot(t);
    if (this.tickCount % 6 === 0) for (const p of this.players.values()) if (!p.bot) this.sendYou(p);
    if (this.tickCount % 60 === 0) this.sendRoster();
    if (this.tickCount % 30 === 0) this.expireBlocks();
    this.noises = this.noises.filter((n) => this.nowS - n.t < 2);
  }

  updatePhase() {
    const nowS = this.nowS;
    if (this.phase === 'buy' && nowS >= this.phaseEnd) {
      this.phase = 'live';
      this.liveStart = nowS;
      this.phaseEnd = nowS + (this.ffa ? this.cfg.TIME : ROUND.ACTION_TIME);
      this.broadcast({ t: 'round', phase: 'live', round: this.round, score: this.score, mode: this.mode });
    } else if (this.phase === 'live' && this.ffa && nowS >= this.phaseEnd) {
      this.endFFA();
    } else if (this.phase === 'end' && nowS >= this.phaseEnd) {
      if (this.round === ROUND.HALFTIME_AFTER) this.halftime();
      this.startRound();
    } else if (this.phase === 'over' && nowS >= this.phaseEnd) {
      this.startMatch();
    }
  }

  updateUtility(dt) {
    const nowS = this.nowS;
    this.smokes = this.smokes.filter((s) => s.until > nowS);
    this.puddles = this.puddles.filter((s) => s.until > nowS);
    this.fires = this.fires.filter((f) => f.until > nowS);
    for (const f of this.fires) {
      const owner = this.players.get(f.owner);
      for (const q of this.players.values()) {
        if (!q.alive) continue;
        if (owner && q !== owner && !this.hostile(owner, q)) continue;
        if (Math.hypot(q.body.x - f.x, q.body.z - f.z) > UTIL.FIRE_RADIUS || Math.abs(q.body.y - f.y) > 1.2) continue;
        q.fireAcc += UTIL.FIRE_DPS * dt;
        if (q.fireAcc >= 8) {
          const d = Math.floor(q.fireAcc);
          q.fireAcc -= d;
          this.damage(q, owner, d, 'fire', { id: 'molotov', armorPen: 1 }, { from: [f.x, f.y, f.z] });
        }
      }
    }
  }

  checkRoundEnd() {
    if (this.phase !== 'live' || this.ffa) return;
    const t = this.alive('T').length, ct = this.alive('CT').length;
    const planted = this.bomb.state === 'planted';
    if (ct === 0 && this.teamPlayers('CT').length) return this.endRound('T', 'elim');
    if (t === 0 && !planted && this.teamPlayers('T').length) return this.endRound('CT', 'elim');
    if (!planted && this.nowS >= this.phaseEnd) return this.endRound('CT', 'time');
  }

  sendSnapshot(t) {
    const nowS = this.nowS;
    const ps = [];
    for (const p of this.players.values()) {
      const b = p.body;
      let flags = 0;
      if (p.scoped) flags |= 1;
      if (p.reloadEnd) flags |= 2;
      if (p.useStart) flags |= 4;
      if (b.onGround) flags |= 8;
      if (p.weapons.bomb) flags |= 16;
      if (nowS < p.blindUntil) flags |= 32;
      if (p.protectUntil > nowS) flags |= 64;
      ps.push([p.id, r2(b.x), r2(b.y), r2(b.z), r2(p.yaw), r2(p.pitch), r2(b.crouch), p.alive ? 1 : 0, p.active, p.hp, flags, r2(b.vx), r2(b.vz)]);
    }
    const b = this.bomb;
    const timeLeft = this.phase === 'live' && b.state === 'planted' ? b.explodeAt - nowS : Math.max(0, this.phaseEnd - nowS);
    this.broadcast({
      t: 'snap', st: t, ps,
      r: [this.phase, r2(timeLeft), this.score.T, this.score.CT, this.round, this.mode],
      b: b.state === 'none' ? null : [b.state, ...(b.pos ? b.pos.map(r2) : [0, 0, 0]), b.carrier || 0, b.explodeAt ? r2(b.explodeAt - nowS) : 0, b.site || ''],
      n: this.nades.map((n) => [n.id, n.type, r2(n.x), r2(n.y), r2(n.z)]),
    });
  }

  sendYou(p) {
    if (p.bot || !p.ws) return;
    const w = p.weapons;
    let use = null;
    if (p.useStart) {
      const need = p.useKind === 'plant' ? ROUND.PLANT_TIME : (w.kit ? ROUND.DEFUSE_TIME_KIT : ROUND.DEFUSE_TIME);
      use = { k: p.useKind, s: r2(this.nowS - p.useStart), n: need };
    }
    let buyLeft = 0;
    if (this.ffa) buyLeft = 999;
    else if (this.phase === 'buy') buyLeft = r2(this.phaseEnd - this.nowS + 20);
    else if (this.phase === 'live') buyLeft = r2(20 - (this.nowS - this.liveStart));
    this.send(p, {
      t: 'you', team: p.team, alive: p.alive, hp: p.hp, ar: p.armor, hm: p.helmet, m: p.money,
      pri: w.primary, sec: w.secondary, gr: w.grenades, bomb: w.bomb, kit: w.kit, act: p.active,
      am: p.ammo, rl: p.reloadEnd ? r2(p.reloadEnd - this.nowS) : 0, use, buy: this.canBuy(p), buyLeft,
      rs: !p.alive && p.respawnAt ? r2(Math.max(0, p.respawnAt - this.nowS)) : 0,
      prot: p.protectUntil > this.nowS,
      bl: p.blocksLeft || 0,
    });
  }

  sendRoster() {
    const list = [...this.players.values()].map((p) => ({
      id: p.id, name: p.name, team: p.team, bot: p.bot, k: p.kills, d: p.deaths, a: p.assists,
      mvp: p.mvps, s: p.score, m: p.money, alive: p.alive, ping: p.bot ? 0 : p.ping, hm: p.helmet, ar: p.armor > 0,
      kit: p.weapons.kit, pri: p.weapons.primary,
    }));
    this.broadcast({ t: 'roster', list, lossStreak: this.lossStreak, mode: this.mode });
  }

  info() {
    return {
      name: this.name,
      private: !!this.private,
      mode: this.mode,
      map: this.mapName,
      humans: this.humans().length,
      bots: [...this.players.values()].filter((p) => p.bot).length,
      phase: this.phase,
      score: this.score,
      round: this.round,
    };
  }
}
