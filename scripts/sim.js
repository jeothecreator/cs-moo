// Headless smoke test: a defusal room and a free-for-all room run side by side in one process
// (exercises the per-tick active-map switching). Logs results and crashes.
import { Match } from '../server/match.js';

const seconds = Number(process.argv[2] || 60);
process.on('uncaughtException', (e) => { console.error('CRASH', e); process.exit(1); });

function fakeWs(tag, counts) {
  return {
    readyState: 1,
    send(data) {
      const m = JSON.parse(data);
      counts[m.t] = (counts[m.t] || 0) + 1;
      if (m.t === 'roundEnd') console.log(`[${tag}] round ${m.round}: ${m.w} wins (${m.r}) T${m.score.T}-CT${m.score.CT}`);
      if (m.t === 'matchEnd') console.log(`[${tag}] match end`, m.ffa ? `${m.winner} ${m.kills} kills` : m.w);
      if (m.t === 'bomb' && m.s === 'planted') console.log(`[${tag}] bomb planted ${m.site}`);
    },
  };
}

const rooms = [];
for (const mode of ['defusal', 'ffa']) {
  const counts = {};
  const match = new Match(`sim-${mode}`, mode);
  const human = match.addHuman(fakeWs(mode, counts), 'Tester', 'CT');
  setInterval(() => { human.alive = false; human.respawnAt = 0; }, 50);
  rooms.push({ mode, match, counts });
}

setTimeout(() => {
  for (const { mode, match, counts } of rooms) {
    const bots = [...match.players.values()].filter((p) => p.bot);
    console.log(`[${mode}] map=${match.mapName} phase=${match.phase} kills=${counts.kill || 0} shots=${counts.shot || 0}`);
    console.log(`[${mode}] K/D:`, bots.map((b) => `${b.name} ${b.kills}/${b.deaths} ${b.weapons.primary}`).join(', '));
    match.destroy();
  }
  process.exit(0);
}, seconds * 1000);
