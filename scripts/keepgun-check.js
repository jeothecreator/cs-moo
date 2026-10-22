// Checks that bought guns survive death (all modes) and reset at halftime / new match.
import { Match } from '../server/match.js';
import { WEAPONS, DEFAULT_PRIMARY } from '../shared/constants.js';

const ws = { readyState: 1, send() {} };
let fail = 0;
const ok = (cond, msg) => { console.log(cond ? 'PASS' : 'FAIL', msg); if (!cond) fail++; };

for (const mode of ['defusal', 'ffa', 'duel']) {
  const m = new Match(`keep-${mode}`, mode);
  m.canBuy = () => true;
  const p = m.addHuman(ws, 'Tester', 'CT');
  const gun = Object.values(WEAPONS).find((w) => w.slot === 'primary' && w.id !== DEFAULT_PRIMARY && (w.team === 'any' || w.team === p.team)).id;
  p.money = 16000;
  m.spawn(p, true);
  ok(m.buy(p, gun), `${mode}: bought ${gun}`);
  ok(m.buy(p, 'magnum'), `${mode}: bought magnum`);
  p.alive = false; p.survived = false;
  if (mode === 'defusal') m.startRound(); else m.spawn(p, true);
  ok(p.weapons.primary === gun && p.weapons.secondary === 'magnum', `${mode}: kept ${gun} + magnum after dying (${p.weapons.primary}, ${p.weapons.secondary})`);
  if (mode === 'defusal') { m.halftime(); p.alive = false; p.survived = false; m.startRound(); }
  else m.startMatch();
  ok(p.weapons.primary === DEFAULT_PRIMARY && p.weapons.secondary === 'p9', `${mode}: reset to defaults after ${mode === 'defusal' ? 'halftime' : 'new match'}`);
  m.destroy();
}
process.exit(fail ? 1 : 0);
