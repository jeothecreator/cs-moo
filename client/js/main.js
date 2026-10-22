// Bootstrap: menus, settings persistence, joining a match.
import { WEAPONS, UTIL, TEAMS } from '/shared/constants.js';
import { MODES } from '/shared/map.js';
import { Game } from './game.js';
import { formatRunTime } from './obby.js';
import { myObbies, inviteLink } from './obbyEditor.js';
import { HUD } from './hud.js';
import { AudioEngine } from './audio.js';
import { preloadAssets } from './assets.js';

const $ = (id) => document.getElementById(id);

const DEFAULTS = {
  sensitivity: 1.2,
  fov: 72,
  volume: 0.6,
  crosshairColor: '#5dff7a',
  crosshairSize: 7,
  crosshairGap: 4,
  crosshairThickness: 2,
  crosshairDot: false,
  dynamicCrosshair: true,
  adsToggle: false,
  cameraBob: true,
  motionIntensity: 0.75,
  renderScale: Math.min(window.devicePixelRatio || 1, 1.5),
  shadows: true,
  quality: 'high',
  style: 'bodycam',
};

function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('csmoo.settings') || '{}') }; } catch { return { ...DEFAULTS }; }
}
function saveSettings(s) {
  try { localStorage.setItem('csmoo.settings', JSON.stringify(s)); } catch { /* storage unavailable */ }
}

// Korean shop signage is painted into canvases when a map is built, so the webfont has to be ready
// first (capped, so a slow font CDN never blocks the menu). Models stream in behind the menu.
await Promise.race([document.fonts.load('900 64px "Noto Sans KR"'), new Promise((r) => setTimeout(r, 2500))]).catch(() => {});
const assetsReady = preloadAssets();

const settings = loadSettings();
const hud = new HUD();
const audio = new AudioEngine();
audio.setVolume(settings.volume);

const game = new Game({
  canvas: $('game'), hud, audio, settings,
  onLeave: (reason) => backToMenu(reason),
});
hud.applyCrosshair(settings);
window.csmoo = game;
document.body.classList.toggle('bodycam', settings.style !== 'tactical');

// Bodycam burn-in: date / time like real footage, ticking every second.
{
  const pad = (n) => String(n).padStart(2, '0');
  const tick = () => {
    const d = new Date();
    $('bcStamp').textContent = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };
  tick();
  setInterval(tick, 1000);
}

// ─── Settings form (menu + pause) ─────────────────────────────
const FIELDS = [
  { key: 'sensitivity', label: 'Sensitivity', type: 'range', min: 0.1, max: 5, step: 0.05 },
  { key: 'fov', label: 'Field of view', type: 'range', min: 55, max: 95, step: 1 },
  { key: 'volume', label: 'Volume', type: 'range', min: 0, max: 1, step: 0.05 },
  { key: 'crosshairColor', label: 'Crosshair color', type: 'color' },
  { key: 'crosshairSize', label: 'Crosshair length', type: 'range', min: 2, max: 20, step: 1 },
  { key: 'crosshairGap', label: 'Crosshair gap', type: 'range', min: 0, max: 20, step: 1 },
  { key: 'crosshairThickness', label: 'Crosshair width', type: 'range', min: 1, max: 5, step: 1 },
  { key: 'crosshairDot', label: 'Center dot', type: 'checkbox' },
  { key: 'dynamicCrosshair', label: 'Dynamic crosshair', type: 'checkbox' },
  { key: 'adsToggle', label: 'Toggle ADS', type: 'checkbox' },
  { key: 'cameraBob', label: 'Camera bob', type: 'checkbox' },
  { key: 'motionIntensity', label: 'Motion intensity', type: 'range', min: 0, max: 1, step: 0.05 },
  { key: 'renderScale', label: 'Render scale', type: 'range', min: 0.5, max: 2, step: 0.25 },
  { key: 'shadows', label: 'Shadows (reload)', type: 'checkbox' },
  { key: 'quality', label: 'Graphics quality', type: 'select', options: ['low', 'medium', 'high', 'ultra'] },
  { key: 'style', label: 'Visual style', type: 'select', options: ['bodycam', 'tactical'] },
];

function buildSettings(container, compact = false) {
  container.innerHTML = '';
  for (const f of FIELDS) {
    if (compact && ['renderScale', 'shadows', 'crosshairThickness', 'dynamicCrosshair', 'motionIntensity'].includes(f.key)) continue;
    const row = document.createElement('div');
    row.className = 'setting';
    const id = `${container.id}-${f.key}`;
    const input = document.createElement(f.type === 'select' ? 'select' : 'input');
    if (f.type !== 'select') input.type = f.type;
    input.id = id;
    const out = document.createElement('output');
    if (f.type === 'range') {
      Object.assign(input, { min: f.min, max: f.max, step: f.step, value: settings[f.key] });
      out.textContent = settings[f.key];
    } else if (f.type === 'color') {
      input.value = settings[f.key];
    } else if (f.type === 'select') {
      for (const o of f.options) {
        const op = document.createElement('option');
        op.value = o;
        op.textContent = o[0].toUpperCase() + o.slice(1);
        input.appendChild(op);
      }
      input.value = settings[f.key];
    } else {
      input.checked = !!settings[f.key];
    }
    input.addEventListener('input', () => {
      settings[f.key] = f.type === 'checkbox' ? input.checked : f.type === 'range' ? Number(input.value) : input.value;
      if (f.type === 'range') out.textContent = settings[f.key];
      saveSettings(settings);
      game.applySettings();
    });
    const label = document.createElement('label');
    label.htmlFor = id;
    label.textContent = f.label;
    row.append(label, input, out);
    container.appendChild(row);
  }
}
buildSettings($('settingsForm'));

// ─── Arsenal page ──────────────────────────────────────────────
{
  const list = $('arsenalList');
  const util = {
    flashbang: `Blinds and deafens anyone facing it for up to ${UTIL.FLASH_MAX}s`,
    molotov: `Burning fuel pool · ${UTIL.FIRE_DPS} dmg/s · slows`,
    smoke: `Thick smoke screen for ${UTIL.SMOKE_DURATION}s`,
    barricade: 'Free every life · Left click to place, right click to pick up · Climb it, then boot-stomp enemies from above',
    he: `Fragmentation · up to ${UTIL.HE_DAMAGE} area damage`,
  };
  for (const w of Object.values(WEAPONS)) {
    if (w.slot === 'bomb' || w.slot === 'special') continue;
    const div = document.createElement('div');
    div.className = 'arsenal-item';
    const stats = w.damage
      ? `${w.cls} · ${w.damage.head}/${w.damage.body}/${w.damage.leg} dmg (head/body/leg) · ${w.rpm} RPM${w.mag ? ` · ${w.mag} rds` : ''}${w.team !== 'any' ? ` · ${TEAMS[w.team].name} only` : ''}`
      : util[w.id];
    div.innerHTML = `<b>${w.name}</b><span class="price">${w.price ? `$${w.price}` : 'Default'}</span><span class="stats">${stats}</span>`;
    list.appendChild(div);
  }
}

// ─── Menu navigation ──────────────────────────────────────────
document.querySelectorAll('.nav-btn').forEach((b) => b.addEventListener('click', () => {
  audio.init();
  audio.click();
  document.querySelectorAll('.nav-btn').forEach((x) => x.classList.toggle('active', x === b));
  document.querySelectorAll('.menu-panel').forEach((p) => { p.hidden = p.dataset.panel !== b.dataset.tab; });
}));

let team = 'auto';
document.querySelectorAll('#menu .team-card').forEach((c) => c.addEventListener('click', () => {
  team = c.dataset.team;
  document.querySelectorAll('#menu .team-card').forEach((x) => x.classList.toggle('selected', x === c));
  audio.init();
  audio.click();
}));

$('nameInput').value = localStorage.getItem('csmoo.name') || '';
const urlCode = new URLSearchParams(location.search).get('code');
if (urlCode) $('codeInput').value = urlCode.toUpperCase();

const savedMode = localStorage.getItem('csmoo.mode');
let mode = ['ffa', 'duel', 'obby'].includes(savedMode) ? savedMode : 'defusal';
function selectMode(m, { preview = true } = {}) {
  mode = m === 'obby' || MODES[m] ? m : 'defusal';
  document.querySelectorAll('.mode-card').forEach((x) => x.classList.toggle('selected', x.dataset.mode === mode));
  document.querySelector('#menu .team-pick').hidden = mode !== 'defusal';
  $('mpActions').hidden = mode === 'obby';
  $('obbyActions').hidden = mode !== 'obby';
  if (mode === 'obby') updateObbyBest();
  if (preview && MODES[mode]) game.loadMap(MODES[mode].map);
  try { localStorage.setItem('csmoo.mode', mode); } catch { /* storage unavailable */ }
}
document.querySelectorAll('.mode-card').forEach((c) => c.addEventListener('click', () => {
  audio.init();
  audio.click();
  selectMode(c.dataset.mode);
}));
selectMode(mode);

async function refreshRooms() {
  const el = $('roomList');
  try {
    const rooms = await (await fetch('/api/rooms')).json();
    const active = rooms.filter((r) => r.humans > 0);
    if (!active.length) {
      el.innerHTML = '<div class="room-empty">No active rooms — start one!</div>';
      return;
    }
    el.innerHTML = '';
    for (const r of active) {
      const d = document.createElement('div');
      d.className = 'room-item';
      const info = r.mode !== 'defusal' ? `${r.humans} players · ${MODES[r.mode]?.name || ''}` : `${r.humans} players · ${r.score.T}:${r.score.CT} · R${r.round}`;
      const label = r.name.replace(/^public-(defusal|ffa|duel)-?/, 'Public ').trim() || r.name;
      d.innerHTML = `<span>${label} <small class="room-mode">${MODES[r.mode]?.name || ''}</small></span><em>${info}</em>`;
      d.onclick = () => joinGame({ action: 'room', room: r.name, mode: r.mode });
      el.appendChild(d);
    }
  } catch {
    el.innerHTML = '<div class="room-empty">Server list unavailable</div>';
  }
}
$('refreshRooms').onclick = refreshRooms;
refreshRooms();
const roomTimer = setInterval(() => { if (!$('menu').hidden) refreshRooms(); }, 5000);

// ─── Multiplayer: quick play, private rooms, room codes ───────
let lanInfo = null;
fetch('/api/info').then((r) => r.json()).then((i) => { lanInfo = i; }).catch(() => {});

function inviteUrl(code) {
  let origin = location.origin;
  const local = /^(localhost|127\.|\[::1\])/.test(location.hostname);
  if (local && lanInfo?.lan?.length) origin = `${location.protocol}//${lanInfo.lan[0]}:${location.port || lanInfo.port}`;
  return `${origin}/?code=${encodeURIComponent(code)}`;
}

function updateInvite(w) {
  $('inviteLabel').textContent = w.priv ? 'Private room code' : 'Public room';
  $('inviteCode').textContent = w.code;
  $('inviteLink').textContent = inviteUrl(w.code);
  $('sbMap').textContent = `${MODES[w.mode]?.name || ''} · ${w.map} · ${w.code}`;
}

async function joinGame({ action, room, mode: joinMode = mode }) {
  audio.init();
  const name = $('nameInput').value.trim() || `Recruit${Math.floor(Math.random() * 900 + 100)}`;
  try { localStorage.setItem('csmoo.name', name); } catch { /* storage unavailable */ }
  $('menuError').textContent = '';
  $('loading').hidden = false;
  try {
    await assetsReady; // soldiers and weapon rigs are built synchronously once the match starts
    const welcome = await game.join({ room, name, team, mode: joinMode, action });
    if (welcome.mode !== mode) selectMode(welcome.mode, { preview: false });
    $('menu').hidden = true;
    $('loading').hidden = true;
    $('clickToPlay').hidden = false;
    updateInvite(welcome);
    history.replaceState(null, '', welcome.priv ? `?code=${welcome.code}` : location.pathname);
    if (welcome.priv) hud.addChat({ system: true, msg: `Private room ${welcome.code} — press Esc to copy the invite link for your friends` });
  } catch (err) {
    $('loading').hidden = true;
    $('menuError').textContent = err.message || 'Failed to join';
  }
}

$('playBtn').addEventListener('click', () => joinGame({ action: 'quick' }));
$('createBtn').addEventListener('click', () => joinGame({ action: 'create' }));
$('codeBtn').addEventListener('click', () => {
  const code = $('codeInput').value.trim();
  if (!code) { $('menuError').textContent = 'Enter a room code first'; return; }
  joinGame({ action: 'code', room: code });
});
$('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('codeBtn').click(); });
$('copyInvite').addEventListener('click', async () => {
  const btn = $('copyInvite');
  try {
    await navigator.clipboard.writeText($('inviteLink').textContent);
    btn.textContent = 'Copied!';
  } catch {
    btn.textContent = 'Copy failed — select the link above';
  }
  setTimeout(() => { btn.textContent = 'Copy invite link'; }, 1800);
});

// ─── Solo obby, Obby Creator & community obbies ────────────────
const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function enterObbyScreen() {
  document.body.classList.add('obby');
  $('menu').hidden = true;
  $('menuError').textContent = '';
}

async function startOfficialObby() {
  audio.init();
  await assetsReady;
  enterObbyScreen();
  game.startObby();
  $('clickToPlay').hidden = false;
}

async function fetchObby(code) {
  const r = await fetch(`/api/obbies/${encodeURIComponent(String(code).trim().toLowerCase())}`);
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Course not found');
  return data;
}

async function playCustomObby(code) {
  if (!String(code || '').trim()) { $('menuError').textContent = 'Enter a course code first'; return; }
  audio.init();
  await assetsReady;
  $('menuError').textContent = '';
  try {
    const def = await fetchObby(code);
    enterObbyScreen();
    game.startObby(def);
    $('clickToPlay').hidden = false;
  } catch (err) {
    $('menuError').textContent = err.message;
  }
}

async function openEditor(code = null) {
  audio.init();
  await assetsReady;
  $('menuError').textContent = '';
  let def = null;
  if (code) {
    try {
      const data = await fetchObby(code);
      def = { ...data, editKey: myObbies().find((o) => o.code === data.code)?.editKey || null };
    } catch (err) {
      $('menuError').textContent = err.message;
      return;
    }
  }
  document.body.classList.add('obby', 'editor');
  $('menu').hidden = true;
  game.startEditor(def);
}

function renderObbyBoard(el, rows) {
  if (!el) return;
  el.innerHTML = rows.length ? '' : '<div class="ol-empty">No runs yet — be the first!</div>';
  rows.forEach((r, i) => {
    const row = document.createElement('div');
    row.className = `ol-row ${i < 3 ? `top${i + 1}` : ''}`;
    row.innerHTML = `<span><i>#${i + 1}</i>${escapeHtml(r.name)}</span><b>${r.finished ? `🏁 ${formatRunTime(r.time)}` : `${Math.floor(r.distance)} m`}</b>`;
    el.appendChild(row);
  });
}

function renderMyObbies() {
  const el = $('myObbyList');
  const list = myObbies();
  el.innerHTML = list.length ? '' : '<div class="ol-empty">Courses you publish show up here</div>';
  for (const o of list) {
    const row = document.createElement('div');
    row.className = 'ol-row';
    row.innerHTML = `<span><b>${escapeHtml(o.name)}</b><small>${o.code.toUpperCase()}</small></span><span class="ol-actions"><button data-a="play">Play</button><button data-a="edit">Edit</button><button data-a="copy">Invite</button></span>`;
    row.querySelector('[data-a=play]').onclick = () => playCustomObby(o.code);
    row.querySelector('[data-a=edit]').onclick = () => openEditor(o.code);
    row.querySelector('[data-a=copy]').onclick = async (e) => {
      try {
        await navigator.clipboard.writeText(inviteLink(o.code));
        e.target.textContent = 'Copied!';
      } catch {
        e.target.textContent = o.code.toUpperCase();
      }
      setTimeout(() => { e.target.textContent = 'Invite'; }, 1600);
    };
    el.appendChild(row);
  }
}

async function updateObbyBest() {
  const best = Number(localStorage.getItem('csmoo.obbyBest'));
  const dist = Number(localStorage.getItem('csmoo.obbyBestDist'));
  $('obbyBestMenu').textContent = best ? formatRunTime(best) : dist ? `${Math.floor(dist)} m` : 'No run yet';
  renderMyObbies();
  try {
    const data = await (await fetch('/api/leaderboard')).json();
    renderObbyBoard($('obbyLeaderboardList'), data.obby.slice(0, 10));
  } catch {
    $('obbyLeaderboardList').innerHTML = '<div class="ol-empty">Leaderboard unavailable</div>';
  }
  try {
    const list = await (await fetch('/api/obbies')).json();
    const el = $('communityList');
    el.innerHTML = list.length ? '' : '<div class="ol-empty">No community courses yet — build the first one!</div>';
    for (const o of list) {
      const row = document.createElement('button');
      row.className = 'ol-row clickable';
      row.innerHTML = `<span><b>${escapeHtml(o.name)}</b><small>by ${escapeHtml(o.author)}</small></span><em>${o.count} blocks · ▶ ${o.plays}</em>`;
      row.onclick = () => playCustomObby(o.code);
      el.appendChild(row);
    }
  } catch {
    $('communityList').innerHTML = '<div class="ol-empty">Community list unavailable</div>';
  }
}

async function refreshLeaderboards() {
  try {
    const data = await (await fetch('/api/leaderboard')).json();
    const kills = $('lbKills');
    kills.innerHTML = data.kills.length ? '' : '<div class="ol-empty">No kills recorded yet — jump into a match!</div>';
    data.kills.forEach((r, i) => {
      const row = document.createElement('div');
      row.className = `ol-row ${i < 3 ? `top${i + 1}` : ''}`;
      row.innerHTML = `<span><i>#${i + 1}</i>${escapeHtml(r.name)}</span><b>${r.kills} ${r.kills === 1 ? 'kill' : 'kills'}</b>`;
      kills.appendChild(row);
    });
    renderObbyBoard($('lbObby'), data.obby);
  } catch {
    $('lbKills').innerHTML = '<div class="ol-empty">Leaderboards unavailable</div>';
    $('lbObby').innerHTML = '<div class="ol-empty">Leaderboards unavailable</div>';
  }
}

$('obbyBtn').addEventListener('click', startOfficialObby);
$('obbyCreateBtn').addEventListener('click', () => openEditor());
$('obbyCodeBtn').addEventListener('click', () => playCustomObby($('obbyCodeInput').value));
$('obbyCodeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('obbyCodeBtn').click(); });
$('obbyRefresh').addEventListener('click', updateObbyBest);
$('lbRefresh').addEventListener('click', refreshLeaderboards);
document.querySelector('.nav-btn[data-tab="leaders"]').addEventListener('click', refreshLeaderboards);
$('obAgain').addEventListener('click', () => {
  game.obby.restart();
  game.lockPointer();
});
$('obMenu').addEventListener('click', () => {
  if (game.obby?.fromEditor) game.resumeEditor();
  else backToMenu();
});

const invitedObby = new URLSearchParams(location.search).get('obby');
if (invitedObby) {
  selectMode('obby', { preview: false });
  $('obbyCodeInput').value = invitedObby.toUpperCase();
  $('menuError').textContent = `You've been invited to obby ${invitedObby.toUpperCase()} — press Play!`;
}

$('clickToPlay').addEventListener('click', () => {
  audio.init();
  $('clickToPlay').hidden = true;
  game.lockPointer();
});

// ─── Pause menu ───────────────────────────────────────────────
$('resumeBtn').onclick = () => { $('pause').hidden = true; game.lockPointer(); };
$('teamBtn').onclick = () => { $('pause').hidden = true; game.openTeamSelect(); };
$('leaveBtn').onclick = () => backToMenu();
document.querySelectorAll('[data-switch]').forEach((b) => b.addEventListener('click', () => game.changeTeam(b.dataset.switch)));
$('tsClose').onclick = () => game.changeTeam(null);

const pauseObserver = new MutationObserver(() => {
  if (!$('pause').hidden) buildSettings($('pauseSettings'), true);
});
pauseObserver.observe($('pause'), { attributes: true, attributeFilter: ['hidden'] });

function backToMenu(reason) {
  game.leave();
  document.body.classList.remove('obby', 'editor');
  updateObbyBest();
  for (const id of ['pause', 'teamSelect', 'clickToPlay', 'buymenu', 'scoreboard', 'matchEnd']) $(id).hidden = true;
  $('menu').hidden = false;
  if (reason) $('menuError').textContent = reason;
  refreshRooms();
}

window.addEventListener('beforeunload', () => clearInterval(roomTimer));
