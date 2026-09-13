// Multiplayer smoke test against a running server:
// host creates a private FFA room, a friend joins by code, a bad code is rejected,
// and private rooms stay out of the public list.
import WebSocket from 'ws';

const BASE = process.env.BASE || 'http://localhost:3000';
const WS = BASE.replace(/^http/, 'ws') + '/ws';

function client(name, joinMsg) {
  return new Promise((resolve) => {
    const ws = new WebSocket(WS);
    const state = { ws, name, welcome: null, error: null, roster: null, money: null };
    ws.on('open', () => ws.send(JSON.stringify({ t: 'join', name, ...joinMsg })));
    ws.on('message', (raw) => {
      const m = JSON.parse(raw);
      if (m.t === 'welcome') { state.welcome = m; resolve(state); }
      if (m.t === 'error') { state.error = m.msg; resolve(state); }
      if (m.t === 'roster') state.roster = m.list;
      if (m.t === 'you') state.money = m.m;
    });
    ws.on('error', (e) => { state.error = e.message; resolve(state); });
  });
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (label, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${extra ? `  (${extra})` : ''}`);
  if (!ok) failed++;
};

const host = await client('Host', { action: 'create', mode: 'ffa' });
check('host created a private room', !!host.welcome?.priv, `code ${host.welcome?.code}`);
check('private room uses free-for-all', host.welcome?.mode === 'ffa');

const friend = await client('Friend', { action: 'code', room: host.welcome.code.toLowerCase() });
check('friend joined with the code', friend.welcome?.code === host.welcome.code);

await wait(1500);
const humans = (friend.roster || []).filter((p) => !p.bot).map((p) => p.name);
check('both players are in the same match', humans.includes('Host') && humans.includes('Friend'), humans.join(', '));

const stranger = await client('Stranger', { action: 'code', room: 'zzzzz' });
check('unknown code is rejected', !!stranger.error, stranger.error);

const rooms = await (await fetch(`${BASE}/api/rooms`)).json();
check('private room hidden from public list', !rooms.some((r) => r.name === host.welcome.code.toLowerCase()));

const quick = await client('Quick', { action: 'quick', mode: 'defusal' });
check('quick play lands in a public room', quick.welcome && !quick.welcome.priv, quick.welcome?.code);

const info = await (await fetch(`${BASE}/api/info`)).json();
check('server reports LAN address for invites', Array.isArray(info.lan), info.lan.join(', ') || 'none');

// FFA kill money: wait for warmup to end, then watch the host's money for a bot kill or any change.
const startMoney = host.money;
console.log(`host money at join: $${startMoney}`);

for (const c of [host, friend, stranger, quick]) c.ws.close();
await wait(300);
console.log(failed ? `\n${failed} check(s) failed` : '\nAll multiplayer checks passed');
process.exit(failed ? 1 : 0);
