// Fast regression checks for the free-for-all rules. Run with `npm test`.
import assert from 'node:assert/strict';
import { Match } from '../server/match.js';
import { dirFromAngles } from '../shared/physics.js';
import { FFA } from '../shared/constants.js';

const messages = [];
const ws = { readyState: 1, send: (data) => messages.push(JSON.parse(data)) };
const match = new Match('ffa-regression', 'ffa');

try {
  const player = match.addHuman(ws, 'Tester', 'T');
  assert.equal(match.ffa, true);
  assert.equal(match.phase, 'buy');
  assert.equal(match.players.size, FFA.PLAYERS, 'FFA should fill empty slots with bots');
  assert.equal(player.alive, true);
  assert.equal(player.armor, 100, 'FFA spawns should grant armor');
  assert.equal(player.helmet, true, 'FFA spawns should grant a helmet');
  assert.ok(player.protectUntil > match.nowS, 'FFA spawn protection should start active');
  assert.deepEqual(player.weapons.grenades, [], 'FFA should not spawn with flash nades');
  for (const bot of [...match.players.values()].filter((p) => p.bot)) {
    assert.ok(bot.brain.skill <= 0.4, 'FFA bots should stay casual');
  }

  const originalShield = player.protectUntil;
  player.ammo[player.active][0] = 0;
  match.phase = 'live';
  assert.equal(match.fireWeapon(player, match.eye(player), [dirFromAngles(player.yaw, player.pitch)], performance.now(), {}), false);
  assert.equal(player.protectUntil, originalShield, 'a dry fire must not consume spawn protection');

  player.ammo[player.active][0] = 1;
  player.lastShot = -10;
  assert.equal(match.fireWeapon(player, match.eye(player), [dirFromAngles(player.yaw, player.pitch)], performance.now(), {}), true);
  assert.equal(player.protectUntil, 0, 'a real shot should end spawn protection');

  match.phase = 'over';
  assert.equal(match.canBuy(player), false, 'loadout changes must close when the match ends');
  assert.ok(messages.some((m) => m.t === 'welcome'));
  console.log('FFA regression checks passed');
} finally {
  match.destroy();
}
