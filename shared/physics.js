// Kinematic player controller + raycasting shared by client prediction and server bots.
import { PLAYER } from './constants.js';
import { MAP, PENETRABLE } from './map.js';

const EPS = 0.001;

function aabbOverlap(b, x0, y0, z0, x1, y1, z1) {
  return x1 > b.min[0] && x0 < b.max[0] && y1 > b.min[1] && y0 < b.max[1] && z1 > b.min[2] && z0 < b.max[2];
}

export function playerHeight(crouch) {
  return PLAYER.HEIGHT + (PLAYER.CROUCH_HEIGHT - PLAYER.HEIGHT) * crouch;
}

export function eyeHeight(crouch) {
  return PLAYER.EYE + (PLAYER.CROUCH_EYE - PLAYER.EYE) * crouch;
}

export function boxBlocked(x, y, z, r, h, boxes = MAP.boxes) {
  for (const b of boxes) if (aabbOverlap(b, x - r, y, z - r, x + r, y + h, z + r)) return b;
  return null;
}

// Moves s along one axis, resolving against boxes. Returns true on collision.
function sweepAxis(s, axis, delta, r, h, boxes, canStep) {
  if (delta === 0) return false;
  const key = axis === 0 ? 'x' : axis === 1 ? 'y' : 'z';
  s[key] += delta;
  let hit = false;
  for (const b of boxes) {
    if (!aabbOverlap(b, s.x - r, s.y, s.z - r, s.x + r, s.y + h, s.z + r)) continue;
    if (axis !== 1 && canStep) {
      const rise = b.max[1] - s.y;
      if (rise > 0 && rise <= PLAYER.STEP && !boxBlocked(s.x, b.max[1] + EPS, s.z, r, h, boxes)) {
        s.y = b.max[1] + EPS;
        continue;
      }
    }
    hit = true;
    if (axis === 1) {
      if (delta > 0) s.y = b.min[1] - h - EPS;
      else s.y = b.max[1] + EPS;
    } else if (delta > 0) {
      s[key] = b.min[axis] - r - EPS;
    } else {
      s[key] = b.max[axis] + r + EPS;
    }
  }
  return hit;
}

function accelerate(s, wx, wz, wishSpeed, accel, dt) {
  const current = s.vx * wx + s.vz * wz;
  const add = wishSpeed - current;
  if (add <= 0) return;
  const a = Math.min(accel * dt * wishSpeed, add);
  s.vx += a * wx;
  s.vz += a * wz;
}

export function newBody(x = 0, y = 0, z = 0) {
  return { x, y, z, vx: 0, vy: 0, vz: 0, onGround: true, crouch: 0 };
}

/**
 * Advance a body. input: { wx, wz (world wish dir, 0..1 length), jump, crouch, walk, speedMult, slick, slow }
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
          const lift = playerHeight(s.crouch) - playerHeight(next);
          const ny = s.y + lift;
          if (ny >= 0 && !boxBlocked(s.x, ny, s.z, PLAYER.RADIUS - 0.02, playerHeight(next), boxes)) s.y = ny;
        }
        s.crouch = next;
      }
    }

    const h = playerHeight(s.crouch);
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

    if (s.onGround) {
      const speed = Math.hypot(s.vx, s.vz);
      if (speed > 0) {
        const fr = PLAYER.FRICTION * (input.slick ? 0.06 : 1);
        const drop = Math.max(speed, PLAYER.STOP_SPEED) * fr * dt;
        const ns = Math.max(0, speed - drop) / speed;
        s.vx *= ns; s.vz *= ns;
      }
      accelerate(s, nx, nz, maxSpeed * wishLen, PLAYER.GROUND_ACCEL * (input.slick ? 0.25 : 1), dt);
      if (input.jump && s.crouch < 0.9) {
        s.vy = PLAYER.JUMP_V;
        s.onGround = false;
        s.jumped = true;
      }
    } else {
      accelerate(s, nx, nz, Math.min(maxSpeed * wishLen, PLAYER.AIR_WISH), PLAYER.AIR_ACCEL, dt);
      // soft cap on bunny-hop speed
      const hs = Math.hypot(s.vx, s.vz);
      const cap = PLAYER.SPEED * 1.45;
      if (hs > cap) { s.vx *= cap / hs; s.vz *= cap / hs; }
    }

    s.vy -= PLAYER.GRAVITY * dt;

    const r = PLAYER.RADIUS;
    if (sweepAxis(s, 0, s.vx * dt, r, h, boxes, s.onGround)) s.vx = 0;
    if (sweepAxis(s, 2, s.vz * dt, r, h, boxes, s.onGround)) s.vz = 0;

    const vyBefore = s.vy;
    const wasGround = s.onGround;
    s.onGround = false;
    if (sweepAxis(s, 1, s.vy * dt, r, h, boxes, false)) {
      if (vyBefore < 0) s.onGround = true;
      s.vy = 0;
    }
    if (s.y <= 0) {
      s.y = 0;
      if (s.vy < 0) s.vy = 0;
      s.onGround = true;
    }
    // stick to ground when walking off small ledges downward
    if (!s.onGround && wasGround && s.vy <= 0 && vyBefore > -1) {
      const probe = { ...s };
      if (sweepAxis(probe, 1, -PLAYER.STEP, r, h, boxes, false) || probe.y <= 0) {
        s.y = Math.max(0, probe.y);
        s.onGround = true;
        s.vy = 0;
      }
    }
    s.landedSpeed = !wasGround && s.onGround ? -vyBefore : 0;
  }
  return s;
}

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

/** Nearest hit against world boxes + ground plane. */
export function raycastWorld(o, d, maxDist = 500, boxes = MAP.boxes) {
  let best = null;
  for (const b of boxes) {
    const r = rayAABB(o[0], o[1], o[2], d[0], d[1], d[2], b.min, b.max);
    if (!r) continue;
    const t = r[0] < 0 ? 0 : r[0];
    if (t <= maxDist && (!best || t < best.t)) {
      const n = [0, 0, 0];
      if (r[2] >= 0) n[r[2]] = r[3];
      best = { t, normal: n, box: b };
    }
  }
  if (d[1] < -1e-6) {
    const t = -o[1] / d[1];
    if (t >= 0 && t <= maxDist && (!best || t < best.t)) best = { t, normal: [0, 1, 0], box: null };
  }
  return best;
}

/** All box intersections along the ray sorted by entry distance (for penetration). */
export function raycastAll(o, d, maxDist = 500, boxes = MAP.boxes) {
  const hits = [];
  for (const b of boxes) {
    const r = rayAABB(o[0], o[1], o[2], d[0], d[1], d[2], b.min, b.max);
    if (!r || r[0] > maxDist) continue;
    const n = [0, 0, 0];
    if (r[2] >= 0) n[r[2]] = r[3];
    hits.push({ t: Math.max(0, r[0]), tOut: r[1], normal: n, box: b, penetrable: !!PENETRABLE[b.mat] });
  }
  if (d[1] < -1e-6) {
    const t = -o[1] / d[1];
    if (t >= 0 && t <= maxDist) hits.push({ t, tOut: Infinity, normal: [0, 1, 0], box: null, penetrable: false });
  }
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

export function raySphere(o, d, c, r) {
  const ox = o[0] - c[0], oy = o[1] - c[1], oz = o[2] - c[2];
  const b = ox * d[0] + oy * d[1] + oz * d[2];
  const cc = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - cc;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : (cc < 0 ? 0 : null);
}

/** Hitboxes for a cow at feet position p with crouch amount c. Returns nearest {t, group}. */
export function rayPlayer(o, d, p, c) {
  const h = playerHeight(c);
  let best = null;
  // Generous hitboxes: they cover the cow's horns, arms and held weapon.
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
