// Loadout checks for the two-gun arsenal: everyone carries the M4 + P9, retired guns can't be
// bought, and gear survives a death within the half but resets at halftime / new match.
import { Match } from '../server/match.js';
import { WEAPONS, DEFAULT_PRIMARY } from '../shared/constants.js';

const ws = { readyState: 1, send() {} };
let fail = 0;
const ok = (cond, msg) => { console.log(cond ? 'PASS' : 'FAIL', msg); if (!cond) fail++; };

ok(Object.values(WEAPONS).filter((w) => w.slot === 'primary' || w.slot === 'secondary').map((w) => w.id).sort().join() === 'carbine,p9', 'arsenal is exactly the M4 and the P9');
for (const mode of ['defusal', 'ffa', 'duel']) {
  const m = new Match(`loadout-${mode}`, mode);
  m.canBuy = () => true;
  const p = m.addHuman(ws, 'Tester', 'CT');
  p.money = 16000;
  m.spawn(p, true);
  ok(p.weapons.primary === DEFAULT_PRIMARY && p.weapons.secondary === 'p9', `${mode}: spawns with M4 + P9`);
  for (const gone of ['scar', 'm4s', 'shotgun', 'sniper', 'magnum']) ok(!m.buy(p, gone), `${mode}: cannot buy retired ${gone}`);
  if (mode === 'defusal') ok(m.buy(p, 'vesthelm') && p.armor === 100 && p.helmet, `${mode}: buys kevlar + helmet`);
  else ok(p.armor === 100 && p.helmet, `${mode}: spawns with kevlar + helmet`);
  p.alive = false; p.survived = false;
  if (mode === 'defusal') m.startRound(); else m.spawn(p, true);
  ok(p.weapons.primary === 'carbine' && p.weapons.secondary === 'p9', `${mode}: still M4 + P9 after dying`);
  m.destroy();
}
process.exit(fail ? 1 : 0);
