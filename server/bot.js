// Server-side bot brains: buy logic, objective play, perception, aim & spray control.
import { WEAPONS, ROUND } from '../shared/constants.js';
import { MAP, siteAt } from '../shared/map.js';
import { eyeHeight, playerHeight, dirFromAngles } from '../shared/physics.js';

export const BOT_NAMES = [
  'Bessie', 'Sir Loin', 'Moo-nster', 'Mootilda', 'T-Bone', 'Angus', 'Moolan', 'Brisket', 'Clarabelle',
  'Holy Cow', 'Moozart', 'Heifer Nothing', 'Cowabunga', 'Udderly', 'Bovinator', 'Cud Chewer', 'Milkshake',
  'Moogan Freeman', 'Big Mac', 'Daisy', 'Buttercup', 'Sirloin Steve', 'Moo Lawn', 'Cheddar',
];

const TAU = Math.PI * 2;
const angDiff = (a, b) => { let d = (a - b) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
const rand = (a, b) => a + Math.random() * (b - a);
const randn = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;

export class BotBrain {
  constructor(match, p) {
    this.m = match;
    this.p = p;
    // Free-for-all is a small arena — keep those brains casual so a human can play.
    if (match.mode === 'duel') {
      this.skill = rand(0.35, 0.55);
      this.aggr = rand(0.4, 0.8);
      this.campy = false;
    } else if (match.ffa) {
      this.skill = rand(0.12, 0.34);
      this.aggr = rand(0.1, 0.45);
      this.campy = Math.random() < 0.5;
    } else {
      this.skill = rand(0.4, 0.78);
      this.aggr = Math.random();
      this.campy = false;
    }
    this.reset('A');
  }

  reset(role) {
    this.role = role;
    this.goal = null;
    this.goalKey = '';
    this.path = null;
    this.pathIdx = 0;
    this.repathAt = 0;
    this.target = null;
    this.lastSeenT = 0;
    this.lastKnown = null;
    this.reactionAt = 0;
    this.errYaw = 0;
    this.errPitch = 0;
    this.nextPerceive = 0;
    this.burst = 0;
    this.pauseUntil = 0;
    this.strafe = 1;
    this.strafeUntil = 0;
    this.bought = false;
    this.buyAt = this.m.nowS + rand(0.5, 4);
    this.departAt = this.m.ffa ? 0 : this.m.nowS + ROUND.BUY_TIME + rand(0, this.p.team === 'T' ? 7 : 1);
    if (this.m.ffa) this.buyAt = this.m.nowS + rand(0.1, 0.8);
    this.roamGoal = null;
    this.roamIdx = 0;
    this.holdSpot = null;
    this.arrived = false;
    this.lookAt = null;
    this.lookUntil = 0;
    this.stuckCheck = 0;
    this.stuckPos = [0, 0];
    this.jitter = null;
    this.thrown = false;
    this.rotated = false;
    this.postSpot = null;
  }

  onHurt(attacker) {
    if (!attacker || !this.m.hostile(this.p, attacker)) return;
    if (!this.target) {
      this.lookAt = [attacker.body.x, attacker.body.z];
      this.lookUntil = this.m.nowS + 1.2;
    }
  }

  // ─── Buying ──────────────────────────────────────────────────
  buy() {
    const { m, p } = this;
    this.bought = true;
    if (m.ffa) {
      const opts = ['milkyway', 'milkyway', 'milkyway', 'pasteurizer', 'udder9', 'ak', 'mooster'];
      m.buy(p, opts[Math.floor(Math.random() * opts.length)]);
      if (Math.random() < 0.18) m.buy(p, 'deag');
      p.active = p.weapons.primary || p.weapons.secondary;
      return;
    }
    const want = [];
    const $ = () => p.money;
    if (!p.weapons.primary) {
      if ($() >= 5750 && Math.random() < 0.15) want.push('creaminator');
      else if (p.team === 'T' && $() >= 3350) want.push('ak');
      else if (p.team === 'CT' && $() >= 3550) want.push('mooster');
      else if ($() >= 2650 && Math.random() < 0.25) want.push('pasteurizer');
      else if ($() >= 1700 && (m.round === 1 || Math.random() < 0.6)) want.push('milkyway');
    }
    for (const item of want) m.buy(p, item);
    if ($() >= 1000 && !(p.armor >= 100 && p.helmet)) m.buy(p, 'vesthelm');
    else if ($() >= 650 && p.armor < 100) m.buy(p, 'vest');
    if (!p.weapons.primary && $() >= 700 && p.weapons.secondary !== 'deag' && Math.random() < 0.5) m.buy(p, 'deag');
    if (p.team === 'CT' && $() >= 400 && Math.random() < 0.6) m.buy(p, 'kit');
    const nades = ['smoke', 'butter', 'he', 'molotov'].sort(() => Math.random() - 0.5);
    for (const g of nades) if ($() >= 600 && Math.random() < 0.5) m.buy(p, g);
    p.active = p.weapons.primary || p.weapons.secondary;
  }

  // ─── Main update ─────────────────────────────────────────────
  update(dt) {
    const { m, p } = this;
    const input = { wx: 0, wz: 0, jump: false, crouch: false, walk: false };
    p.input = input;
    p.use = false;
    if (m.phase === 'buy') {
      if (!this.bought && m.nowS >= this.buyAt) this.buy();
      return;
    }
    if (m.phase !== 'live' && m.phase !== 'end') return;

    const nowS = m.nowS;
    if (m.ffa && !this.bought && nowS >= this.buyAt) this.buy();
    if (m.ffa && nowS < p.protectUntil) {
      this.target = null;
      if (m.phase === 'live') this.objectiveFFA(dt, input);
      return;
    }
    if (nowS >= this.nextPerceive) {
      this.nextPerceive = nowS + (m.ffa ? 0.22 : 0.1);
      this.perceive();
    }
    const blind = nowS < p.blindUntil;
    if (this.target && !blind && this.target.alive) {
      this.combat(dt, input);
    } else {
      if (this.target && !this.target.alive) this.target = null;
      this.ensureWeapon();
      if (blind) {
        // stumble backwards while blinded
        const d = dirFromAngles(p.yaw, 0);
        input.wx = -d[0] * 0.6; input.wz = -d[2] * 0.6;
        return;
      }
      if (m.phase === 'live') {
        if (m.ffa) this.objectiveFFA(dt, input);
        else this.objective(dt, input);
      }
    }
  }

  ensureWeapon() {
    const { m, p } = this;
    if (p.active === 'bomb' && !this.planting) m.switchWeapon(p, p.weapons.primary || p.weapons.secondary || 'hoof');
    const w = WEAPONS[p.active];
    const a = p.ammo[p.active];
    if (w && a && a[0] < w.mag * 0.4 && a[1] > 0 && !p.reloadEnd) m.startReload(p);
    if (a && a[0] === 0 && a[1] === 0) {
      const alt = [p.weapons.primary, p.weapons.secondary].find((id) => id && p.ammo[id]?.[0] > 0);
      m.switchWeapon(p, alt || 'hoof');
    }
    if (w?.slot === 'grenade') m.switchWeapon(p, p.weapons.primary || p.weapons.secondary || 'hoof');
  }

  perceive() {
    const { m, p } = this;
    if (m.nowS < p.blindUntil) return;
    const eye = m.eye(p);
    const view = dirFromAngles(p.yaw, 0);
    const range = m.ffa ? 48 : 95;
    const fov = m.ffa ? Math.cos(0.72) : Math.cos(1.25);
    let best = null, bestD = Infinity, bestInFov = false;
    for (const q of m.players.values()) {
      if (!q.alive || !m.hostile(p, q)) continue;
      if (q.protectUntil > m.nowS) continue;
      const dx = q.body.x - p.body.x, dz = q.body.z - p.body.z;
      const dist = Math.hypot(dx, dz);
      if (dist > range) continue;
      const inFov = (view[0] * dx + view[2] * dz) / (dist || 1) > fov;
      const recentlyHurt = p.lastHurtBy === q.id && m.nowS - p.lastHurtT < (m.ffa ? 0.9 : 1.5);
      const heard = dist < (m.ffa ? 3.2 : 5);
      if (!inFov && !recentlyHurt && !heard && this.target !== q) continue;
      const h = playerHeight(q.body.crouch);
      const head = [q.body.x, q.body.y + h - 0.2, q.body.z];
      const chest = [q.body.x, q.body.y + h * 0.62, q.body.z];
      if (!m.canSee(eye, head) && !m.canSee(eye, chest)) continue;
      const hunters = m.ffa ? [...m.players.values()].filter((x) => x.bot && x.alive && x !== p && x.brain?.target === q).length : 0;
      if (m.ffa && hunters >= 1 && this.target !== q && !recentlyHurt) continue;
      const humanBias = m.ffa && !q.bot ? 1.8 : 1;
      const score = dist * (this.target === q ? 0.6 : 1) * humanBias;
      if (score < bestD) { bestD = score; best = q; bestInFov = inFov; }
    }
    if (best) {
      if (best !== this.target) {
        const react = (m.ffa ? 0.45 : 0.2) + (1 - this.skill) * (m.ffa ? 0.7 : 0.35);
        this.reactionAt = m.nowS + react * (bestInFov ? 1 : 1.6) * (m.ffa && !best.bot ? 1.35 : 1);
        const err = ((m.ffa ? 10 : 4.5) - this.skill * (m.ffa ? 4 : 3)) * Math.PI / 180;
        this.errYaw = randn() * err * 1.8;
        this.errPitch = randn() * err * 1.2;
        this.aimHead = Math.random() < (m.ffa ? 0.04 + this.skill * 0.08 : 0.15 + this.skill * 0.3);
        this.burst = 0;
      }
      this.target = best;
      this.lastSeenT = m.nowS;
      this.lastKnown = [best.body.x, best.body.z];
      if (!m.ffa) m.reportSighting(p.team, [best.body.x, best.body.y, best.body.z]);
    } else if (this.target && m.nowS - this.lastSeenT > (m.ffa ? 0.25 : 0.4)) {
      this.target = null;
    }
    // hearing
    if (!this.target) {
      for (const n of m.noises) {
        if ((m.ffa ? n.id === p.id : n.team === p.team) || m.nowS - n.t > 0.3 || !n.loud) continue;
        if (Math.hypot(n.x - p.body.x, n.z - p.body.z) < 30) {
          this.lookAt = [n.x, n.z];
          this.lookUntil = m.nowS + 1.5;
        }
      }
    }
  }

  // ─── Fighting ────────────────────────────────────────────────
  combat(dt, input) {
    const { m, p } = this;
    const q = this.target;
    this.planting = false;
    const h = playerHeight(q.body.crouch);
    // aim at predicted position of target (lead a little; FFA bots barely lead)
    const lead = m.ffa ? 0.01 : 0.06;
    const tx = q.body.x + q.body.vx * lead, tz = q.body.z + q.body.vz * lead;
    const ty = q.body.y + (this.aimHead ? h - 0.2 : h * (m.ffa ? 0.48 : 0.6));
    const eye = m.eye(p);
    const dx = tx - eye[0], dy = ty - eye[1], dz = tz - eye[2];
    const horiz = Math.hypot(dx, dz);
    const dist = Math.hypot(horiz, dy);
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, horiz);

    if (m.ffa) {
      this.errYaw += randn() * dt * 0.55;
      this.errPitch += randn() * dt * 0.28;
    }
    const decay = Math.exp(-dt * (m.ffa ? 0.9 + this.skill * 1.4 : 2 + this.skill * 4));
    this.errYaw *= decay; this.errPitch *= decay;
    const turn = Math.min(1, dt * (m.ffa ? 3.2 + this.skill * 3.5 : 7 + this.skill * 9));
    p.yaw += angDiff(yaw + this.errYaw, p.yaw) * turn;
    p.pitch += (pitch + this.errPitch - p.pitch) * turn;

    // weapon selection
    let w = WEAPONS[p.active];
    let a = p.ammo[p.active];
    if (!w || w.slot === 'grenade' || w.slot === 'bomb') {
      m.switchWeapon(p, p.weapons.primary || p.weapons.secondary || 'hoof');
      return;
    }
    if (a && a[0] === 0) {
      const other = [p.weapons.primary, p.weapons.secondary].find((id) => id && id !== p.active && p.ammo[id]?.[0] > 0);
      if (other && dist < 15) m.switchWeapon(p, other);
      else if (a[1] > 0) m.startReload(p);
      else m.switchWeapon(p, other || 'hoof');
    }
    w = WEAPONS[p.active];

    if (w.id === 'creaminator' && !p.scoped) p.scoped = 1;

    // strafing / movement
    const nowS = m.nowS;
    if (nowS > this.strafeUntil) {
      this.strafe = Math.random() < 0.5 ? -1 : 1;
      this.strafeUntil = nowS + rand(0.35, 0.9);
    }
    const fx = dx / (horiz || 1), fz = dz / (horiz || 1);
    const sx = -fz * this.strafe, sz = fx * this.strafe;
    const angErr = Math.abs(angDiff(yaw, p.yaw)) + Math.abs(pitch - p.pitch);
    const tol = Math.max(m.ffa ? 0.04 : 0.012, Math.atan2(this.aimHead ? 0.18 : 0.3, dist)) * (m.ffa ? 2.1 : 1.3);
    const ready = nowS >= this.reactionAt && angErr < tol && nowS >= this.pauseUntil && !p.reloadEnd;

    const precise = w.cls === 'Rifle' || w.cls === 'Sniper' || w.id === 'deag';
    const moving = m.ffa || !(precise && dist > 10 && ready);
    if (w.slot === 'melee') {
      input.wx = fx; input.wz = fz;
    } else if (moving) {
      input.wx = sx; input.wz = sz;
      if (this.aggr > 0.7 && dist > 12) { input.wx += fx * 0.5; input.wz += fz * 0.5; }
    }
    if (dist < 3 && w.slot !== 'melee') { input.wx -= fx * 0.6; input.wz -= fz * 0.6; }

    if (!ready) return;
    if (w.slot === 'melee') {
      if (dist < 1.8) m.botShoot(p);
      return;
    }
    if (m.ffa && Math.random() < (0.28 + (!q.bot ? 0.18 : 0))) return;
    const interval = w.auto ? 60 / w.rpm : Math.max(60 / w.rpm, 0.2 + (1 - this.skill) * 0.2);
    if (nowS - p.lastShot < interval * (m.ffa ? 1.25 : 1)) return;
    const maxBurst = w.auto ? (m.ffa ? (dist > 18 ? 2 : 4) : (dist > 30 ? 2 : dist > 15 ? 5 : 12)) : 99;
    if (m.botShoot(p)) {
      this.burst++;
      if (this.burst >= maxBurst) {
        this.burst = 0;
        this.pauseUntil = nowS + rand(m.ffa ? 0.45 : 0.25, m.ffa ? 0.9 : 0.45);
        this.errYaw += randn() * (m.ffa ? 0.06 : 0.02);
        this.errPitch += randn() * (m.ffa ? 0.03 : 0.01);
      }
    }
  }

  // ─── Objective ───────────────────────────────────────────────
  objective(dt, input) {
    const { m, p } = this;
    const nowS = m.nowS;
    if (nowS < this.departAt) { this.idleLook(dt); return; }
    const bomb = m.bomb;
    let goal = null, goalKey = '', holdLook = null, walk = false;

    if (p.team === 'T') {
      if (bomb.state === 'dropped' && this.isClosestTo(bomb.pos, 'T')) {
        goal = [bomb.pos[0], bomb.pos[2]]; goalKey = 'bomb';
      } else if (p.weapons.bomb) {
        const site = siteAt(p.body.x, p.body.z);
        const center = MAP.sites[site || m.teamPlan.T].center;
        if (site && Math.hypot(p.body.x - center[0], p.body.z - center[1]) < 7) {
          // plant
          this.planting = true;
          if (p.active !== 'bomb') m.switchWeapon(p, 'bomb');
          p.use = true;
          this.idleLook(dt);
          return;
        }
        this.planting = false;
        goal = center; goalKey = 'plant' + m.teamPlan.T;
      } else if (bomb.state === 'planted') {
        if (!this.postSpot) this.postSpot = m.nav.randomNear(bomb.pos[0], bomb.pos[2], 9);
        goal = this.postSpot; goalKey = 'post';
        const e = MAP.entries[bomb.site] || MAP.entries.A;
        holdLook = e[p.id % e.length];
      } else {
        const site = m.teamPlan.T;
        const entry = MAP.entries[site][p.id % 2];
        const carrier = m.players.get(bomb.carrier);
        const cDist = carrier ? Math.hypot(carrier.body.x - entry[0], carrier.body.z - entry[1]) : 0;
        const nearEntry = Math.hypot(p.body.x - entry[0], p.body.z - entry[1]) < 4;
        if (!this.jitter) this.jitter = m.nav.randomNear(...MAP.sites[site].center, 8);
        const waitLimit = carrier && !carrier.bot ? 20 : ROUND.ACTION_TIME - 35;
        if (this.goalKey.startsWith('entry') && nearEntry && cDist > 14 && nowS - m.liveStart < waitLimit) {
          goal = entry; goalKey = 'entry' + site;
        } else if (this.goalKey === 'site' + site || nearEntry || !carrier) {
          goal = this.jitter; goalKey = 'site' + site;
          if (!this.thrown && nearEntry) this.throwUtility(MAP.sites[site].center);
        } else {
          goal = entry; goalKey = 'entry' + site;
        }
      }
    } else {
      if (bomb.state === 'planted') {
        goal = [bomb.pos[0], bomb.pos[2]]; goalKey = 'defuse';
        if (Math.hypot(p.body.x - bomb.pos[0], p.body.z - bomb.pos[2]) < 1.4) {
          p.use = true;
          this.idleLook(dt);
          return;
        }
      } else {
        const s = m.sightings.T;
        if (s && s.site && nowS - s.t < 10 && s.site !== this.role && this.role !== s.site && (this.rotated || Math.random() < 0.02)) {
          if (!this.rotated) { this.rotated = true; this.holdSpot = null; }
          this.role = s.site;
        }
        if (!this.holdSpot) {
          const spots = MAP.holdSpots[this.role] || MAP.holdSpots.mid;
          this.holdSpot = spots[(p.id + (this.rotated ? 1 : 0)) % spots.length];
        }
        goal = this.holdSpot.p; goalKey = 'hold' + this.role + this.holdSpot.p.join();
        holdLook = this.holdSpot.look;
        walk = this.rotated && Math.hypot(p.body.x - goal[0], p.body.z - goal[1]) < 15;
      }
    }

    // chase last known enemy position when aggressive
    if (this.lastKnown && nowS - this.lastSeenT < 3 && this.aggr > 0.55 && goalKey !== 'defuse' && !p.weapons.bomb) {
      goal = this.lastKnown; goalKey = 'chase';
    }

    this.moveTo(goal, goalKey, input, dt, holdLook);
    input.walk = walk;
  }

  objectiveFFA(dt, input) {
    const { m, p } = this;
    const nowS = m.nowS;
    const chaseHuman = this.target && !this.target.bot;
    const chase = this.lastKnown && nowS - this.lastSeenT < (this.campy || chaseHuman ? 1.2 : 2.4) && this.aggr > 0.32;
    let goal, key, look = null;
    if (chase && !this.campy) {
      goal = this.lastKnown;
      key = 'chase';
    } else {
      if (!this.roamGoal || (this.arrived && this.goalKey.startsWith('roam'))) {
        const pts = MAP.roam || MAP.spawns.FFA || [[0, 0]];
        const humans = [...m.players.values()].filter((q) => !q.bot && q.alive);
        let best = pts[0], bestScore = -Infinity;
        for (let i = 0; i < pts.length; i++) {
          const pt = pts[i];
          let nearH = 80, nearB = 80;
          for (const h of humans) nearH = Math.min(nearH, Math.hypot(h.body.x - pt[0], h.body.z - pt[1]));
          for (const b of m.players.values()) {
            if (!b.bot || b === p || !b.alive) continue;
            nearB = Math.min(nearB, Math.hypot(b.body.x - pt[0], b.body.z - pt[1]));
          }
          const score = (this.campy ? nearH : Math.min(22, nearH)) + nearB * 0.35 + Math.random() * 6;
          if (score > bestScore) { bestScore = score; best = pt; this.roamIdx = i; }
        }
        this.roamGoal = m.nav.randomNear(best[0], best[1], this.campy ? 1.2 : 3);
        this.arrived = false;
      }
      goal = this.roamGoal;
      key = `roam${this.roamIdx}:${goal[0].toFixed(1)}`;
      if (this.campy && this.arrived) look = [0, 0];
    }
    this.moveTo(goal, key, input, dt, look);
    input.walk = this.campy || nowS < p.protectUntil;
  }

  isClosestTo(pos, team) {
    let best = null, bd = Infinity;
    for (const q of this.m.alive(team)) {
      const d = Math.hypot(q.body.x - pos[0], q.body.z - pos[2]);
      if (d < bd) { bd = d; best = q; }
    }
    return best === this.p;
  }

  throwUtility(targetXZ) {
    const { m, p } = this;
    this.thrown = true;
    const g = ['butter', 'smoke', 'he', 'molotov'].find((x) => p.weapons.grenades.includes(x));
    if (!g) return;
    const eye = m.eye(p);
    const dx = targetXZ[0] - eye[0], dz = targetXZ[1] - eye[2];
    const d = Math.hypot(dx, dz);
    const angle = 0.6;
    const speed = Math.min(22, Math.sqrt((d * 18) / Math.sin(2 * angle)));
    const v = [(dx / d) * Math.cos(angle) * speed, Math.sin(angle) * speed, (dz / d) * Math.cos(angle) * speed];
    m.throwGrenade(p, g, eye, v);
  }

  moveTo(goal, key, input, dt, holdLook) {
    const { m, p } = this;
    const nowS = m.nowS;
    if (!goal) { this.idleLook(dt); return; }
    if (key !== this.goalKey || nowS > this.repathAt || !this.path) {
      if (key !== this.goalKey) this.arrived = false;
      this.goalKey = key;
      this.path = m.nav.findPath(p.body.x, p.body.z, goal[0], goal[1]);
      this.pathIdx = 0;
      this.repathAt = nowS + rand(2, 3.5);
    }
    const distGoal = Math.hypot(p.body.x - goal[0], p.body.z - goal[1]);
    if (distGoal < 1.0 || !this.path) {
      this.arrived = true;
      if (holdLook) this.faceTowards(holdLook, dt, 4);
      else this.idleLook(dt);
      return;
    }
    let next = this.path[this.pathIdx];
    while (next && Math.hypot(next[0] - p.body.x, next[1] - p.body.z) < 0.7 && this.pathIdx < this.path.length - 1) {
      this.pathIdx++;
      next = this.path[this.pathIdx];
    }
    if (!next) return;
    const dx = next[0] - p.body.x, dz = next[1] - p.body.z;
    const l = Math.hypot(dx, dz) || 1;
    input.wx = dx / l; input.wz = dz / l;

    if (nowS < this.lookUntil && this.lookAt) this.faceTowards(this.lookAt, dt, 8);
    else this.faceTowards(next, dt, 5);

    // stuck detection
    if (nowS > this.stuckCheck) {
      const moved = Math.hypot(p.body.x - this.stuckPos[0], p.body.z - this.stuckPos[1]);
      if (moved < 0.35 && this.stuckCheck) {
        input.jump = true;
        this.path = null;
        const side = Math.random() < 0.5 ? -1 : 1;
        input.wx += -input.wz * side; input.wz += input.wx * side;
      }
      this.stuckPos = [p.body.x, p.body.z];
      this.stuckCheck = nowS + 1;
    }
  }

  faceTowards(xz, dt, rate) {
    const p = this.p;
    const yaw = Math.atan2(-(xz[0] - p.body.x), -(xz[1] - p.body.z));
    p.yaw += angDiff(yaw, p.yaw) * Math.min(1, dt * rate);
    p.pitch += (0 - p.pitch) * Math.min(1, dt * 4);
  }

  idleLook(dt) {
    const { m, p } = this;
    if (m.nowS < this.lookUntil && this.lookAt) this.faceTowards(this.lookAt, dt, 8);
  }
}
