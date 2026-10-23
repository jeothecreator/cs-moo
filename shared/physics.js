// Player movement and ray casting against convex brushes, shared by client prediction, the server
// and bots. Movement is Quake/Source-style: a box hull is traced through brush planes (each pushed
// out by the hull's extent), slides along whatever it hits, steps up ledges, snaps down stairs and
// treats anything steeper than ~45° as a slope you slide off. Ladders climb like CS.
import { PLAYER } from './constants.js';
import { MAP, PENETRABLE } from './map.js';
import { brushPlanes, indexOf } from './brushes.js';

const SURF = 0.003;    // stop this far short of a surface (Quake's DIST_EPSILON)
const MIN_FLOOR = 0.7; // walkable when normal.y ≥ this
// The old procedural maps stand on an infinite floor at y = 0; compiled maps set boxes.noGround.
const GROUND = { min: [-1e5, -1e5, -1e5], max: [1e5, 0, 1e5], planes: null, mat: 'ground', ground: true };

export function playerHeight(crouch) {
  return PLAYER.HEIGHT + (PLAYER.CROUCH_HEIGHT - PLAYER.HEIGHT) * crouch;
}

export function eyeHeight(crouch) {
  return PLAYER.EYE + (PLAYER.CROUCH_EYE - PLAYER.EYE) * crouch;
}

// ─── traces ───────────────────────────────────────────────────

/** Clip a hull's motion start→end against one brush (Quake's CM_TraceThroughBrush). */
function traceBrush(tr, b, s, e, hx, hy, hz) {
  if (tr.allSolid || (tr.skipClip && b.clip)) return;
  const P = brushPlanes(b);
  let enter = -1, leave = 1, hit = -1, startOut = false, getOut = false;
  for (let i = 0; i < P.length; i += 4) {
    const nx = P[i], ny = P[i + 1], nz = P[i + 2];
    const dist = P[i + 3] + (nx < 0 ? -nx : nx) * hx + (ny < 0 ? -ny : ny) * hy + (nz < 0 ? -nz : nz) * hz;
    const d1 = nx * s[0] + ny * s[1] + nz * s[2] - dist;
    const d2 = nx * e[0] + ny * e[1] + nz * e[2] - dist;
    if (d2 > 0) getOut = true;
    if (d1 > 0) startOut = true;
    if (d1 > 0 && (d2 >= SURF || d2 >= d1)) return;
    if (d1 <= 0 && d2 <= 0) continue;
    if (d1 > d2) {
      const f = (d1 - SURF) / (d1 - d2);
      if (f > enter) { enter = f; hit = i; }
    } else {
      const f = (d1 + SURF) / (d1 - d2);
      if (f < leave) leave = f;
    }
  }
  if (!startOut) {
    tr.startSolid = true;
    if (!getOut) { tr.allSolid = true; tr.fraction = 0; tr.brush = b; }
    return;
  }
  if (enter < leave && enter > -1 && enter < tr.fraction) {
    tr.fraction = Math.max(0, enter);
    tr.normal = [P[hit], P[hit + 1], P[hit + 2]];
    tr.brush = b;
  }
}

/**
 * Sweep an axis-aligned box (half extents hx, hy, hz) from centre `start` to `end`.
 * Returns { fraction, end, normal, brush, startSolid, allSolid }.
 */
export function trace(start, end, hx, hy, hz, boxes = MAP.boxes, skipClip = false) {
  const tr = { fraction: 1, normal: null, brush: null, startSolid: false, allSolid: false, skipClip };
  const idx = indexOf(boxes);
  const test = (b) => traceBrush(tr, b, start, end, hx, hy, hz);
  const dx = end[0] - start[0], dz = end[2] - start[2];
  if (hx === 0 && hz === 0 && dx * dx + dz * dz > 64) {
    const len = Math.hypot(dx, end[1] - start[1], dz);
    const d = [dx / len, (end[1] - start[1]) / len, dz / len];
    idx.ray(start, d, len, (b) => { test(b); return tr.fraction * len; });
  } else {
    idx.query(Math.min(start[0], end[0]) - hx - 0.01, Math.min(start[2], end[2]) - hz - 0.01,
      Math.max(start[0], end[0]) + hx + 0.01, Math.max(start[2], end[2]) + hz + 0.01, test);
  }
  if (!boxes.noGround) test(GROUND);
  tr.end = [start[0] + (end[0] - start[0]) * tr.fraction, start[1] + (end[1] - start[1]) * tr.fraction, start[2] + (end[2] - start[2]) * tr.fraction];
  return tr;
}

/** The brush a standing hull (feet at x,y,z) would overlap, or null. */
export function boxBlocked(x, y, z, r, h, boxes = MAP.boxes) {
  const c = [x, y + h / 2, z];
  const tr = trace(c, c, r, h / 2, r, boxes);
  return tr.allSolid ? (tr.brush === GROUND ? GROUND : tr.brush) : null;
}

// ─── movement ─────────────────────────────────────────────────

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function clipVelocity(v, n, overbounce = 1.001) {
  const back = dot3(v, n) * overbounce;
  return [v[0] - n[0] * back, v[1] - n[1] * back, v[2] - n[2] * back];
}

/** Quake's fly/slide move: up to four bumps, sliding along every plane touched. */
function slideMove(s, h, dt, boxes) {
  const hy = h / 2, R = PLAYER.RADIUS;
  let time = dt;
  let v = [s.vx, s.vy, s.vz];
  const primal = v.slice();
  const planes = [];
  let blocked = false;
  for (let bump = 0; bump < 4; bump++) {
    const c = [s.x, s.y + hy, s.z];
    const tr = trace(c, [c[0] + v[0] * time, c[1] + v[1] * time, c[2] + v[2] * time], R, hy, R, boxes);
    if (tr.allSolid) { v = [0, 0, 0]; blocked = true; break; }
    if (tr.fraction > 0) { s.x = tr.end[0]; s.y = tr.end[1] - hy; s.z = tr.end[2]; planes.length = 0; }
    if (tr.fraction >= 1) break;
    blocked = true;
    time -= time * tr.fraction;
    if (planes.length >= 5) { v = [0, 0, 0]; break; }
    planes.push(tr.normal);
    let i = 0;
    for (; i < planes.length; i++) {
      const c1 = clipVelocity(v, planes[i]);
      let j = 0;
      for (; j < planes.length; j++) if (j !== i && dot3(c1, planes[j]) < 0) break;
      if (j === planes.length) { v = c1; break; }
    }
    if (i === planes.length) {
      if (planes.length !== 2) { v = [0, 0, 0]; break; }
      const a = planes[0], b = planes[1];
      let dir = [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
      const l = Math.hypot(...dir) || 1;
      dir = dir.map((x) => x / l);
      const sp = dot3(dir, v);
      v = dir.map((x) => x * sp);
    }
    if (dot3(v, primal) <= 0) { v = [0, 0, 0]; break; }
  }
  s.vx = v[0]; s.vy = v[1]; s.vz = v[2];
  return blocked;
}

/** Ground move: slide, and if that bumped into something, also try stepping up over it. */
function stepSlideMove(s, h, dt, boxes) {
  const start = { x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz };
  if (!slideMove(s, h, dt, boxes)) return;
  const flat = { x: s.x, y: s.y, z: s.z, vx: s.vx, vy: s.vy, vz: s.vz };
  const hy = h / 2, R = PLAYER.RADIUS;
  Object.assign(s, start);
  const up = trace([s.x, s.y + hy, s.z], [s.x, s.y + hy + PLAYER.STEP, s.z], R, hy, R, boxes);
  if (up.allSolid) { Object.assign(s, flat); return; }
  const rise = up.end[1] - (s.y + hy);
  s.y += rise;
  slideMove(s, h, dt, boxes);
  const dn = trace([s.x, s.y + hy, s.z], [s.x, s.y + hy - rise - 0.02, s.z], R, hy, R, boxes);
  if (!dn.allSolid) s.y = dn.end[1] - hy;
  const onFloor = dn.fraction < 1 && dn.normal && dn.normal[1] >= MIN_FLOOR;
  const dStep = (s.x - start.x) ** 2 + (s.z - start.z) ** 2;
  const dFlat = (flat.x - start.x) ** 2 + (flat.z - start.z) ** 2;
  if (!onFloor || dStep <= dFlat + 1e-8) { Object.assign(s, flat); return; }
  s.vy = 0;
}

function categorize(s, h, boxes) {
  const hy = h / 2, R = PLAYER.RADIUS;
  if (s.vy > 1.8) { s.onGround = false; s.groundN = null; return; }
  const tr = trace([s.x, s.y + hy, s.z], [s.x, s.y + hy - 0.06, s.z], R, hy, R, boxes);
  if (tr.fraction < 1 && tr.normal && tr.normal[1] >= MIN_FLOOR) {
    s.onGround = true;
    s.groundN = tr.normal;
    s.y = tr.end[1] - hy;
  } else {
    s.onGround = false;
    s.groundN = null;
  }
}

/** Nudge a body out of solid geometry (spawned or crouch-stood into a wall). */
function unstick(s, h, boxes) {
  if (!boxBlocked(s.x, s.y, s.z, PLAYER.RADIUS - 0.01, h, boxes)) return;
  for (let r = 0.05; r <= 1.2; r += 0.05) {
    for (const [dx, dy, dz] of [[0, r, 0], [r, 0, 0], [-r, 0, 0], [0, 0, r], [0, 0, -r], [r, r, 0], [-r, r, 0], [0, r, r], [0, r, -r]]) {
      if (!boxBlocked(s.x + dx, s.y + dy, s.z + dz, PLAYER.RADIUS - 0.01, h, boxes)) { s.x += dx; s.y += dy; s.z += dz; return; }
    }
  }
}

function accelerate(s, wx, wz, wishSpeed, accel, dt) {
  const current = s.vx * wx + s.vz * wz;
  const add = wishSpeed - current;
  if (add <= 0) return;
  const a = Math.min(accel * dt * wishSpeed, add);
  s.vx += a * wx;
  s.vz += a * wz;
}

function ladderAt(s, h) {
  const L = MAP.ladders;
  if (!L?.length) return null;
  const r = PLAYER.RADIUS + 0.12;
  for (const l of L) {
    if (s.x + r > l.min[0] && s.x - r < l.max[0] && s.z + r > l.min[2] && s.z - r < l.max[2] && s.y + h > l.min[1] && s.y < l.max[1] + 0.2) return l;
  }
  return null;
}

export function newBody(x = 0, y = 0, z = 0) {
  return { x, y, z, vx: 0, vy: 0, vz: 0, onGround: true, crouch: 0 };
}

/**
 * Advance a body. input: { wx, wz (world wish dir, 0..1 length), jump, crouch, walk, speedMult,
 * slick, slow, airControl, noCap, pitch (for ladders) }
 */
export function stepBody(s, input, dtTotal, boxes = MAP.boxes) {
  let remaining = Math.min(dtTotal, 0.1);
  while (remaining > 1e-5) {
    const dt = Math.min(remaining, 1 / 60);
    remaining -= dt;

    // crouch transitions (check headroom when standing up)
    const wantCrouch = input.crouch ? 1 : 0;
    if (wantCrouch !== s.crouch) {
      const next = s.crouch + Math.sign(wantCrouch - s.crouch) * Math.min(Math.abs(wantCrouch - s.crouch), dt * 7);
      if (next < s.crouch && boxBlocked(s.x, s.y + 0.01, s.z, PLAYER.RADIUS - 0.02, playerHeight(next), boxes)) {
        // no headroom — stay crouched
      } else {
        // Crouching mid-air tucks the legs up (crouch-jump); standing back up lowers them again.
        if (!s.onGround) {
          const ny = s.y + playerHeight(s.crouch) - playerHeight(next);
          if (!boxBlocked(s.x, ny, s.z, PLAYER.RADIUS - 0.02, playerHeight(next), boxes)) s.y = ny;
        }
        s.crouch = next;
      }
    }

    const h = playerHeight(s.crouch);
    unstick(s, h, boxes);
    let maxSpeed = PLAYER.SPEED * (input.speedMult ?? 1);
    if (s.crouch > 0.5) maxSpeed *= PLAYER.CROUCH_MULT;
    else if (input.walk) maxSpeed *= PLAYER.WALK_MULT;
    if (input.slow) maxSpeed *= 0.55;

    let wx = input.wx || 0, wz = input.wz || 0;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    const wishLen = Math.min(1, wl);
    const nx = wl > 0 ? wx / Math.max(wl, 1e-6) : 0;
    const nz = wl > 0 ? wz / Math.max(wl, 1e-6) : 0;
    const wasGround = s.onGround;

    // Ladders: push toward the rungs to climb (look down to descend), jump to let go.
    const ladder = ladderAt(s, h);
    if (ladder) {
      const lx = (ladder.min[0] + ladder.max[0]) / 2 - s.x, lz = (ladder.min[2] + ladder.max[2]) / 2 - s.z;
      const ll = Math.hypot(lx, lz) || 1;
      const toward = (nx * lx + nz * lz) / ll * wishLen;
      if (input.jump) {
        s.vx = -lx / ll * 3.5; s.vz = -lz / ll * 3.5; s.vy = 3;
      } else if (toward > -0.3) {
        const climb = 3.4 * (toward > 0.2 ? ((input.pitch ?? 0) < -0.4 ? -1 : 1) : 0);
        s.vx = nx * wishLen * 1.6; s.vz = nz * wishLen * 1.6; s.vy = climb;
        slideMove(s, h, dt, boxes);
        categorize(s, h, boxes);
        s.jumped = false;
        s.landedSpeed = 0;
        continue;
      }
    }

    if (s.onGround) {
      const speed = Math.hypot(s.vx, s.vz);
      if (speed > 0) {
        const fr = PLAYER.FRICTION * (input.slick ? 0.06 : 1);
        const drop = Math.max(speed, PLAYER.STOP_SPEED) * fr * dt;
        const ns = Math.max(0, speed - drop) / speed;
        s.vx *= ns; s.vz *= ns;
      }
      accelerate(s, nx, nz, maxSpeed * wishLen, PLAYER.GROUND_ACCEL * (input.slick ? 0.25 : 1), dt);
      s.vy = 0;
      if (input.jump && s.crouch < 0.9) {
        s.vy = PLAYER.JUMP_V;
        s.onGround = false;
        s.jumped = true;
      }
    } else {
      if (input.airControl) {
        // platformer-style steering (solo course)
        accelerate(s, nx, nz, maxSpeed * wishLen, 12, dt);
        if (wishLen === 0) { const k = Math.max(0, 1 - 2.5 * dt); s.vx *= k; s.vz *= k; }
      } else {
        accelerate(s, nx, nz, Math.min(maxSpeed * wishLen, PLAYER.AIR_WISH), PLAYER.AIR_ACCEL, dt);
      }
      // soft cap on bunny-hop speed
      const hs = Math.hypot(s.vx, s.vz);
      const cap = PLAYER.SPEED * 1.45;
      if (!input.noCap && hs > cap) { s.vx *= cap / hs; s.vz *= cap / hs; }
    }

    const vyBefore = s.vy;
    if (s.onGround) {
      // Walk along the floor plane, so ramps and stairs are followed rather than launched off.
      if (s.groundN) { const v = clipVelocity([s.vx, 0, s.vz], s.groundN); s.vx = v[0]; s.vy = v[1]; s.vz = v[2]; }
      stepSlideMove(s, h, dt, boxes);
    } else {
      s.vy -= PLAYER.GRAVITY * dt * 0.5;
      slideMove(s, h, dt, boxes);
      s.vy -= PLAYER.GRAVITY * dt * 0.5;
    }
    categorize(s, h, boxes);
    // Stick to the floor when walking down stairs or off small ledges.
    if (!s.onGround && wasGround && !s.jumped && s.vy <= 0.5) {
      const hy = h / 2;
      const tr = trace([s.x, s.y + hy, s.z], [s.x, s.y + hy - PLAYER.STEP - 0.05, s.z], PLAYER.RADIUS, hy, PLAYER.RADIUS, boxes);
      if (tr.fraction < 1 && tr.normal && tr.normal[1] >= MIN_FLOOR) {
        s.y = tr.end[1] - hy;
        s.onGround = true;
        s.groundN = tr.normal;
      }
    }
    if (s.onGround) { s.vy = 0; s.jumped = false; }
    s.landedSpeed = !wasGround && s.onGround ? -Math.min(vyBefore, 0) : 0;
  }
  return s;
}

// ─── rays (bullets, sight lines) ──────────────────────────────

// Ray vs AABB (slab). Returns [tmin, tmax, normalAxis, normalSign] or null.
export function rayAABB(ox, oy, oz, dx, dy, dz, min, max) {
  let tmin = -Infinity, tmax = Infinity, axis = -1, sign = 0;
  const o = [ox, oy, oz], d = [dx, dy, dz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (o[i] < min[i] || o[i] > max[i]) return null;
      continue;
    }
    const inv = 1 / d[i];
    let t1 = (min[i] - o[i]) * inv;
    let t2 = (max[i] - o[i]) * inv;
    let s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = i; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return [tmin, tmax, axis, sign];
}

/** Ray vs convex brush: [tEnter, tExit, normal] or null. */
function rayBrush(o, d, b) {
  const P = brushPlanes(b);
  let t0 = -Infinity, t1 = Infinity, hit = -1;
  for (let i = 0; i < P.length; i += 4) {
    const denom = P[i] * d[0] + P[i + 1] * d[1] + P[i + 2] * d[2];
    const dist = P[i] * o[0] + P[i + 1] * o[1] + P[i + 2] * o[2] - P[i + 3];
    if (Math.abs(denom) < 1e-12) { if (dist > 0) return null; continue; }
    const t = -dist / denom;
    if (denom < 0) { if (t > t0) { t0 = t; hit = i; } } else if (t < t1) t1 = t;
    if (t0 > t1) return null;
  }
  if (t1 < 0) return null;
  return [t0, t1, hit >= 0 ? [P[hit], P[hit + 1], P[hit + 2]] : [0, 0, 0]];
}

/** Nearest bullet hit against the world (player clips let bullets through). */
export function raycastWorld(o, d, maxDist = 500, boxes = MAP.boxes) {
  const tr = trace(o, [o[0] + d[0] * maxDist, o[1] + d[1] * maxDist, o[2] + d[2] * maxDist], 0, 0, 0, boxes, true);
  if (tr.fraction >= 1) return null;
  return { t: tr.fraction * maxDist, normal: tr.normal || [0, 0, 0], box: tr.brush?.ground ? null : tr.brush };
}

/** Every brush along the ray, sorted by entry distance (for wallbang penetration). */
export function raycastAll(o, d, maxDist = 500, boxes = MAP.boxes) {
  const hits = [];
  const consider = (b) => {
    if (b.clip) return;
    const r = rayBrush(o, d, b);
    if (!r || r[0] > maxDist) return;
    hits.push({ t: Math.max(0, r[0]), tOut: r[1], normal: r[2], box: b.ground ? null : b, penetrable: !!(b.pen || PENETRABLE[b.mat]) });
  };
  indexOf(boxes).ray(o, d, maxDist, (b) => { consider(b); return maxDist; });
  if (!boxes.noGround) consider(GROUND);
  hits.sort((a, b) => a.t - b.t);
  return hits;
}

export function lineClear(a, b, boxes = MAP.boxes) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return true;
  const hit = raycastWorld(a, [dx / len, dy / len, dz / len], len, boxes);
  return !hit || hit.t >= len - 0.05;
}

// ─── sandbag barricades ───────────────────────────────────────

/**
 * Where a 1 m barricade lands for a look ray: snapped to the metre grid in x/z and dropped onto
 * the surface below that cell. Returns [x, y, z] (min corner) or null.
 */
export function blockSpot(eye, dir, reach, boxes = MAP.boxes) {
  const hit = raycastWorld(eye, dir, reach, boxes);
  const n = hit?.normal;
  if (!n || (!n[0] && !n[1] && !n[2])) return null;
  const p = [eye[0] + dir[0] * hit.t, eye[1] + dir[1] * hit.t, eye[2] + dir[2] * hit.t];
  const x = Math.floor(p[0] + n[0] * 0.5), z = Math.floor(p[2] + n[2] * 0.5);
  const from = p[1] + 0.6;
  const tr = trace([x + 0.5, from, z + 0.5], [x + 0.5, from - 4, z + 0.5], 0.45, 0.01, 0.45, boxes);
  if (tr.startSolid || tr.fraction >= 1 || !tr.normal || tr.normal[1] < 0.7) return null;
  return [x, Math.round((tr.end[1] - 0.01) * 100) / 100, z];
}

/** A barricade at min corner (x, y, z) fits: in bounds, not inside the world, resting on something. */
export function blockFits(x, y, z, boxes = MAP.boxes) {
  const B = MAP.bounds;
  if (!Number.isFinite(y) || x < B.minX || x + 1 > B.maxX || z < B.minZ || z + 1 > B.maxZ) return false;
  if (y < (MAP.floorY ?? 0) - 1 || y > (MAP.ceilingY ?? PLAYER.HEIGHT * 6)) return false;
  if (boxBlocked(x + 0.5, y + 0.02, z + 0.5, 0.48, 0.96, boxes)) return false;
  return !!boxBlocked(x + 0.5, y - 0.06, z + 0.5, 0.45, 0.05, boxes);
}

export function raySphere(o, d, c, r) {
  const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2];
  const b = ox * d[0] + oy * d[1] + oz * d[2];
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : (cc < 0 ? 0 : null);
}

/** Hitboxes for a player at feet position p with crouch amount c. Returns nearest {t, group}. */
export function rayPlayer(o, d, p, c) {
  const h = playerHeight(c);
  let best = null;
  // Generous hitboxes: they cover the helmet, arms and held weapon.
  const head = raySphere(o, d, [p[0], p[1] + h - 0.2, p[2]], 0.31);
  if (head !== null) best = { t: head, group: 'head' };
  const bodyMin = [p[0] - 0.46, p[1] + h * 0.45, p[2] - 0.46];
  const bodyMax = [p[0] + 0.46, p[1] + h - 0.45, p[2] + 0.46];
  const body = rayAABB(o[0], o[1], o[2], d[0], d[1], d[2], bodyMin, bodyMax);
  if (body && (!best || body[0] < best.t)) best = { t: Math.max(0, body[0]), group: 'body' };
  const legMin = [p[0] - 0.36, p[1], p[2] - 0.36];
  const legMax = [p[0] + 0.36, p[1] + h * 0.45, p[2] + 0.36];
  const leg = rayAABB(o[0], o[1], o[2], d[0], d[1], d[2], legMin, legMax);
  if (leg && (!best || leg[0] < best.t)) best = { t: Math.max(0, leg[0]), group: 'leg' };
  return best;
}

export function dirFromAngles(yaw, pitch) {
  const cp = Math.cos(pitch);
  return [-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp];
}

export function anglesFromDir(d) {
  return { yaw: Math.atan2(-d[0], -d[2]), pitch: Math.asin(Math.max(-1, Math.min(1, d[1]))) };
}

/** Apply spread (radians) + recoil offsets (degrees) to a view direction. rng: () => [0,1) */
export function shotDirection(yaw, pitch, spread, recoilYawDeg, recoilPitchDeg, rng = Math.random) {
  const ry = yaw + (recoilYawDeg * Math.PI) / 180;
  const rp = pitch + (recoilPitchDeg * Math.PI) / 180;
  const ang = rng() * Math.PI * 2;
  const mag = spread * Math.sqrt(rng());
  return dirFromAngles(ry + Math.cos(ang) * mag, rp + Math.sin(ang) * mag);
}

export function segmentSphere(a, b, c, r) {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const len2 = dx * dx + dy * dy + dz * dz;
  let t = len2 > 0 ? ((c[0] - a[0]) * dx + (c[1] - a[1]) * dy + (c[2] - a[2]) * dz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const px = a[0] + dx * t - c[0], py = a[1] + dy * t - c[1], pz = a[2] + dz * t - c[2];
  return px * px + py * py + pz * pz <= r * r;
}
