import express from 'express';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { Match } from './match.js';
import { createStore } from './store.js';
import { precompressed, warm } from './compress.js';
import { validateObbyBlocks, OBBY_LIMITS, OBBY_MAX_DISTANCE } from '../shared/obby.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = process.env.DATA_DIR || path.join(root, 'server', 'data');

const app = express();
const STATIC = { '/': 'client', '/shared': 'shared', '/lib/three': 'node_modules/three/build', '/lib/three-addons': 'node_modules/three/examples/jsm' };
for (const [mount, dir] of Object.entries(STATIC)) {
  app.use(mount, precompressed(path.join(root, dir)), express.static(path.join(root, dir)));
}
warm([
  'shared/maps/de_cache.js', 'client/assets/maps/de_cache.glb', 'node_modules/three/build/three.module.js', 'node_modules/three/build/three.core.js',
].map((f) => path.join(root, f)));

const rooms = new Map();
const CODE_CHARS = 'abcdefghjkmnpqrstuvwxyz23456789';

function sanitizeRoom(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 20);
}

function randomCode(len, taken) {
  for (;;) {
    let code = '';
    for (let i = 0; i < len; i++) code += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!taken(code)) return code;
  }
}

function cleanName(name, max = 16, fallback = 'Recruit') {
  return String(name || '').replace(/[<>&"'`]/g, '').replace(/\s+/g, ' ').trim().slice(0, max) || fallback;
}

function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push(a.address);
  }
  return out;
}

// ─── Persistent stores ───────────────────────────────────────────
const stats = createStore(path.join(DATA_DIR, 'stats.json'), { kills: {}, obby: {} });
const obbies = createStore(path.join(DATA_DIR, 'obbies.json'), { obbies: {} });

/** Called by every match when a real (non-bot) player gets a kill. */
Match.recordKill = (name) => {
  const display = cleanName(name, 16, '');
  if (!display) return;
  const key = display.toLowerCase();
  const row = stats.data.kills[key] || { name: display, kills: 0 };
  row.name = display;
  row.kills += 1;
  row.updated = Date.now();
  stats.data.kills[key] = row;
  stats.save();
};

// crude per-IP rate limit for write endpoints
const hits = new Map();
function limited(req, perMinute) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'ip';
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  list.push(now);
  hits.set(ip, list);
  return list.length > perMinute;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, list] of hits) if (!list.some((t) => now - t < 60_000)) hits.delete(ip);
}, 60_000);

// ─── Rooms ──────────────────────────────────────────────────────
const capacity = (m) => (m.mode === 'duel' ? 2 : m.ffa ? 12 : 10);

/** Resolve which room a join request lands in. Returns { match } or { error }. */
function resolveRoom(msg) {
  const mode = ['ffa', 'duel'].includes(msg.mode) ? msg.mode : 'defusal';
  switch (msg.action) {
    case 'create': {
      const code = randomCode(5, (c) => rooms.has(c));
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
      const match = rooms.get(sanitizeRoom(msg.room));
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

// ─── Leaderboards ────────────────────────────────────────────────
function obbyRanking() {
  return Object.values(stats.data.obby)
    .sort((a, b) => (b.finished - a.finished) || (a.finished ? a.time - b.time : b.distance - a.distance))
    .slice(0, 25);
}

app.get('/api/leaderboard', (_req, res) => {
  const kills = Object.values(stats.data.kills).sort((a, b) => b.kills - a.kills).slice(0, 25);
  res.json({ kills, obby: obbyRanking() });
});

/** Official course progress: furthest distance, or finish time once completed. One row per callsign. */
app.post('/api/obby/run', express.json({ limit: '4kb' }), (req, res) => {
  if (limited(req, 30)) return res.status(429).json({ error: 'slow down' });
  const name = cleanName(req.body?.name);
  const distance = Number(req.body?.distance);
  const finished = !!req.body?.finished;
  const time = finished ? Number(req.body?.time) : null;
  if (!Number.isFinite(distance) || distance < 0 || distance > OBBY_MAX_DISTANCE) return res.status(400).json({ error: 'invalid distance' });
  if (finished && (!Number.isFinite(time) || time < 15 || time > 7200)) return res.status(400).json({ error: 'invalid time' });
  const key = name.toLowerCase();
  const prev = stats.data.obby[key];
  const next = {
    name,
    distance: Math.round(distance * 10) / 10,
    finished,
    time: finished ? Math.round(time * 100) / 100 : null,
    updated: Date.now(),
  };
  const better = !prev
    || (next.finished && !prev.finished)
    || (next.finished === prev.finished && (next.finished ? next.time < prev.time : next.distance > prev.distance));
  if (better) {
    stats.data.obby[key] = next;
    stats.save();
  }
  const rank = obbyRanking().findIndex((r) => r.name.toLowerCase() === key) + 1;
  res.json({ best: stats.data.obby[key], rank: rank || null });
});

// ─── Community obbies ────────────────────────────────────────────
function summary(o) {
  return { code: o.code, name: o.name, author: o.author, count: o.blocks.length, plays: o.plays || 0, best: o.scores?.[0] || null, updated: o.updated };
}

app.get('/api/obbies', (_req, res) => {
  res.json(Object.values(obbies.data.obbies).sort((a, b) => b.updated - a.updated).slice(0, 40).map(summary));
});

app.get('/api/obbies/:code', (req, res) => {
  const o = obbies.data.obbies[sanitizeRoom(req.params.code)];
  if (!o) return res.status(404).json({ error: 'Course not found — check the code' });
  res.json({ code: o.code, name: o.name, author: o.author, blocks: o.blocks, plays: o.plays || 0, scores: o.scores || [] });
});

/** Create a new obby, or update one you own (matching code + editKey). */
app.post('/api/obbies', express.json({ limit: '600kb' }), (req, res) => {
  if (limited(req, 20)) return res.status(429).json({ error: 'Saving too often — wait a moment' });
  const check = validateObbyBlocks(req.body?.blocks);
  if (!check.ok) return res.status(400).json({ error: check.error });
  const name = cleanName(req.body?.name, OBBY_LIMITS.NAME, 'Untitled course');
  const author = cleanName(req.body?.author);
  const code = sanitizeRoom(req.body?.code);
  const existing = code ? obbies.data.obbies[code] : null;
  if (existing && req.body?.editKey && existing.editKey === req.body.editKey) {
    Object.assign(existing, { name, author, blocks: check.blocks, updated: Date.now() });
    obbies.save();
    return res.json({ code: existing.code, editKey: existing.editKey });
  }
  const newCode = randomCode(6, (c) => !!obbies.data.obbies[c]);
  const editKey = crypto.randomBytes(16).toString('hex');
  obbies.data.obbies[newCode] = {
    code: newCode, name, author, blocks: check.blocks, editKey, plays: 0, scores: [], created: Date.now(), updated: Date.now(),
  };
  obbies.save();
  res.json({ code: newCode, editKey });
});

app.post('/api/obbies/:code/play', (req, res) => {
  const o = obbies.data.obbies[sanitizeRoom(req.params.code)];
  if (!o) return res.status(404).json({ error: 'Course not found' });
  if (!limited(req, 60)) {
    o.plays = (o.plays || 0) + 1;
    obbies.save();
  }
  res.json({ plays: o.plays });
});

app.post('/api/obbies/:code/score', express.json({ limit: '4kb' }), (req, res) => {
  const o = obbies.data.obbies[sanitizeRoom(req.params.code)];
  if (!o) return res.status(404).json({ error: 'Course not found' });
  if (limited(req, 30)) return res.status(429).json({ error: 'slow down' });
  const time = Number(req.body?.time);
  if (!Number.isFinite(time) || time < 1 || time > 7200) return res.status(400).json({ error: 'invalid time' });
  const name = cleanName(req.body?.name);
  const rounded = Math.round(time * 100) / 100;
  o.scores = o.scores || [];
  const prev = o.scores.find((s) => s.name.toLowerCase() === name.toLowerCase());
  if (!prev) o.scores.push({ name, time: rounded });
  else if (rounded < prev.time) prev.time = rounded;
  o.scores.sort((a, b) => a.time - b.time);
  o.scores = o.scores.slice(0, 20);
  obbies.save();
  res.json({ scores: o.scores });
});

// ─── WebSocket game server ───────────────────────────────────────
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
      const name = cleanName(msg.name);
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
  console.log(`FRONTLINE server running → http://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`  Friends on your network: http://${ip}:${PORT}`);
});
