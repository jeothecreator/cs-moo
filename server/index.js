import express from 'express';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Match } from './match.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);

const app = express();
app.use(express.static(path.join(root, 'client')));
app.use('/shared', express.static(path.join(root, 'shared')));
app.use('/lib/three', express.static(path.join(root, 'node_modules/three/build')));
app.use('/lib/three-addons', express.static(path.join(root, 'node_modules/three/examples/jsm')));

const rooms = new Map();
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';

function sanitizeRoom(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20);
}

function newCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < 5; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

const capacity = (m) => (m.mode === 'duel' ? 2 : m.ffa ? 12 : 10);

/** Resolve which room a join request lands in. Returns { match } or { error }. */
function resolveRoom(msg) {
  const mode = ['ffa', 'duel'].includes(msg.mode) ? msg.mode : 'defusal';
  switch (msg.action) {
    case 'create': {
      const code = newCode();
      const match = new Match(code, mode);
      match.private = true;
      rooms.set(code, match);
      return { match };
    }
    case 'code': {
      const code = sanitizeRoom(msg.room);
      const match = rooms.get(code);
      if (!code || !match) return { error: `No room found with code ${String(msg.room || '').toUpperCase()}` };
      return { match };
    }
    case 'room': {
      const name = sanitizeRoom(msg.room);
      const match = rooms.get(name);
      if (match) return { match };
      break;
    }
    default:
      break;
  }
  // Quick play: first public room of this mode with space, else open a new one.
  for (let i = 1; i < 50; i++) {
    const name = i === 1 ? `public-${mode}` : `public-${mode}-${i}`;
    let match = rooms.get(name);
    if (!match) {
      match = new Match(name, mode);
      rooms.set(name, match);
    }
    if (match.humans().length < capacity(match)) return { match };
  }
  return { error: 'All public rooms are full' };
}

app.get('/api/rooms', (_req, res) => {
  res.json([...rooms.values()].filter((m) => !m.private).map((m) => m.info()));
});

app.get('/api/info', (_req, res) => {
  res.json({ port: PORT, lan: lanAddresses() });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (ws) => {
  let player = null;
  let match = null;
  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (!player) {
      if (msg.t !== 'join') return;
      const found = resolveRoom(msg);
      if (found.error) {
        ws.send(JSON.stringify({ t: 'error', msg: found.error }));
        return;
      }
      match = found.match;
      const name = String(msg.name || 'Calf').replace(/[<>]/g, '').trim().slice(0, 16) || 'Calf';
      if (match.humans().length >= capacity(match)) {
        ws.send(JSON.stringify({ t: 'error', msg: `Room is full (${capacity(match)}/${capacity(match)})` }));
        return;
      }
      player = match.addHuman(ws, name, msg.team);
      return;
    }
    match.handleMessage(player, msg);
  });
  ws.on('close', () => {
    if (player && match) match.removePlayer(player);
  });
});

// Reap empty rooms
setInterval(() => {
  for (const [name, m] of rooms) {
    if (m.humans().length === 0 && performance.now() - m.emptySince > 60_000) {
      m.destroy();
      rooms.delete(name);
    }
  }
}, 10_000);

server.listen(PORT, '0.0.0.0', () => {
  console.log(`CS:Moo server running → http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  Friends on your network: http://${ip}:${PORT}`);
});
