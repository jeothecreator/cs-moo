// Bootstrap: menus, settings persistence, joining a match.
import { WEAPONS, UTIL } from '/shared/constants.js';
import { MODES } from '/shared/map.js';
import { Game } from './game.js';
import { formatRunTime } from './obby.js';
import { HUD } from './hud.js';
import { AudioEngine } from './audio.js';

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
};

function loadSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem('csmoo.settings') || '{}') }; } catch { return { ...DEFAULTS }; }
}
function saveSettings(s) {
  try { localStorage.setItem('csmoo.settings', JSON.stringify(s)); } catch { /* storage unavailable */ }
}

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
];

function buildSettings(container, compact = false) {
  container.innerHTML = '';
  for (const f of FIELDS) {
    if (compact && ['renderScale', 'shadows', 'crosshairThickness', 'dynamicCrosshair', 'motionIntensity'].includes(f.key)) continue;
    const row = document.createElement('div');
    row.className = 'setting';
    const id = `${container.id}-${f.key}`;
    const input = document.createElement('input');
    input.type = f.type;
    input.id = id;
    const out = document.createElement('output');
    if (f.type === 'range') {
      Object.assign(input, { min: f.min, max: f.max, step: f.step, value: settings[f.key] });
      out.textContent = settings[f.key];
    } else if (f.type === 'color') {
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
    butter: `Blinds enemies in butter for up to ${UTIL.FLASH_MAX}s`,
    molotov: `Melted fondue pool · ${UTIL.FIRE_DPS} dmg/s · slows`,
    smoke: `Sour green stink cloud for ${UTIL.SMOKE_DURATION}s`,
    cowblock: 'Free every life · Left click to place, right click to pick up · Climb it, then Moo Stomp enemies from above',
    he: `Curd fragments · up to ${UTIL.HE_DAMAGE} area damage`,
  };
  for (const w of Object.values(WEAPONS)) {
    if (w.slot === 'bomb' || w.slot === 'special') continue;
    const div = document.createElement('div');
    div.className = 'arsenal-item';
    const stats = w.damage
      ? `${w.cls} · ${w.damage.head}/${w.damage.body}/${w.damage.leg} dmg (head/body/leg) · ${w.rpm} RPM${w.mag ? ` · ${w.mag} rds` : ''}${w.team !== 'any' ? ` · ${w.team === 'T' ? 'Bulls only' : 'Guard only'}` : ''}`
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
  const name = $('nameInput').value.trim() || `Calf${Math.floor(Math.random() * 900 + 100)}`;
  try { localStorage.setItem('csmoo.name', name); } catch { /* storage unavailable */ }
  $('menuError').textContent = '';
  $('loading').hidden = false;
  try {
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

// ─── Solo obby ─────────────────────────────────────────────────
function updateObbyBest() {
  const best = Number(localStorage.getItem('csmoo.obbyBest'));
  $('obbyBestMenu').textContent = best ? formatRunTime(best) : 'No run yet';
}

$('obbyBtn').addEventListener('click', () => {
  audio.init();
  $('menuError').textContent = '';
  document.body.classList.add('obby');
  game.startObby();
  $('menu').hidden = true;
  $('clickToPlay').hidden = false;
});
$('obAgain').addEventListener('click', () => {
  game.obby.restart();
  game.lockPointer();
});
$('obMenu').addEventListener('click', () => backToMenu());

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
  document.body.classList.remove('obby');
  updateObbyBest();
  for (const id of ['pause', 'teamSelect', 'clickToPlay', 'buymenu', 'scoreboard', 'matchEnd']) $(id).hidden = true;
  $('menu').hidden = false;
  if (reason) $('menuError').textContent = reason;
  refreshRooms();
}

window.addEventListener('beforeunload', () => clearInterval(roomTimer));
