import { PLAYER } from './constants.js';

/** Current inaccuracy (radians) for a shooter body using weapon w. */
export function computeSpread(body, w, scoped = false) {
  if (!w.spread && w.spread !== 0) return 0;
  const speed = Math.hypot(body.vx, body.vz);
  const maxSpeed = PLAYER.SPEED * (w.speedMult || 1);
  const frac = Math.min(1, speed / maxSpeed);
  let s = scoped && w.scopedSpread != null ? w.scopedSpread : w.spread;
  s += w.moveSpread * Math.max(0, frac - 0.3) / 0.7;
  if (!body.onGround) s += w.jumpSpread;
  if (body.crouch > 0.5) s *= 0.72;
  // aiming down sights tightens every gun that has no dedicated scope
  if (scoped && w.scopedSpread == null) s *= w.adsSpread ?? 0.5;
  return s;
}

/** Apply armor to a raw damage number. Returns { health, armorLoss }. */
export function armorDamage(raw, group, armor, helmet, armorPen) {
  const protectedHit = (group === 'head' && helmet) || (group === 'body' && armor > 0) || (group === 'generic' && armor > 0);
  if (!protectedHit) return { health: raw, armorLoss: 0 };
  const health = raw * armorPen;
  let armorLoss = (raw - health) * 0.5;
  let extra = 0;
  if (armorLoss > armor) {
    extra = (armorLoss - armor) * 2;
    armorLoss = armor;
  }
  return { health: health + extra, armorLoss };
}

export function rangeFalloff(w, dist) {
  return Math.pow(w.falloff ?? 1, dist / 10);
}
