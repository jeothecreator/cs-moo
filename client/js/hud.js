// DOM heads-up display: vitals, ammo, round bar, radar, kill feed, buy menu, scoreboard, chat.
import { WEAPONS, EQUIPMENT, BUY_MENU, TEAMS, FFA, itemInfo, modeConfig } from '/shared/constants.js';
import { MAP } from '/shared/map.js';
import { weaponIcon } from './viewmodel.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const KILL_ICONS = { he: 'He-Cheese', molotov: 'Cheese Molotov', bomb: 'Sour Milk Bomb', suicide: 'suicide', fire: 'Cheese Molotov', generic: 'world' };

export function weaponLabel(id) {
  return WEAPONS[id]?.name || KILL_ICONS[id] || id;
}

export class HUD {
  constructor() {
    this.el = {
      hud: $('hud'), hp: $('hpText'), hpBar: $('hpBar'), armor: $('armorText'), armorBar: $('armorBar'), helmet: $('helmetIcon'),
      mag: $('magText'), reserve: $('reserveText'), wname: $('weaponName'), money: $('moneyText'), moneyDelta: $('moneyDelta'),
      timer: $('timerText'), round: $('roundText'), bombIcon: $('bombIcon'), scoreT: $('scoreT'), scoreCT: $('scoreCT'),
      aliveT: $('aliveT'), aliveCT: $('aliveCT'), killfeed: $('killfeed'), inventory: $('inventory'), center: $('centerMsg'),
      banner: $('roundBanner'), progress: $('progress'), dmg: $('dmgIndicators'), flash: $('flashOverlay'), smoke: $('smokeOverlay'),
      hurt: $('hurtOverlay'), fire: $('fireOverlay'), scope: $('scope'), crosshair: $('crosshair'), hitmarker: $('hitmarker'),
      spectate: $('spectate'), deathInfo: $('deathInfo'), netgraph: $('netgraph'), radar: $('radar'), buyHint: $('buyHint'), spawnShield: $('spawnShield'),
      chatLog: $('chatLog'), chatInput: $('chatInput'), chatRow: document.querySelector('.chat-input-row'), chatMode: $('chatMode'), chat: $('chat'),
      buymenu: $('buymenu'), bmGrid: $('bmGrid'), bmMoney: $('bmMoney'), bmTime: $('bmTime'),
      scoreboard: $('scoreboard'), sbT: $('sbT'), sbCT: $('sbCT'), sbScoreT: $('sbScoreT'), sbScoreCT: $('sbScoreCT'), sbRound: $('sbRound'),
      matchEnd: $('matchEnd'),
    };
    this.lastMoney = null;
    this.cache = {};
    this.radarCtx = this.el.radar.getContext('2d');
    this.radarImg = this.renderRadarMap();
    this.centerTimer = null;
    this.bannerTimer = null;
  }

  set(key, el, value, prop = 'textContent') {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    el[prop] = value;
  }

  show(v) { this.el.hud.hidden = !v; }

  setVitals(hp, armor, helmet) {
    this.set('hp', this.el.hp, String(hp));
    this.el.hpBar.style.width = `${hp}%`;
    this.el.hp.parentElement.classList.toggle('low', hp <= 25);
    this.set('ar', this.el.armor, String(armor));
    this.el.armorBar.style.width = `${armor}%`;
    this.el.helmet.hidden = !helmet;
  }

  setAmmo(id, mag, reserve) {
    const w = WEAPONS[id];
    this.set('wname', this.el.wname, w?.name || '');
    const slash = this.el.reserve.previousElementSibling;
    if (!w || w.mag == null || !w.mag) {
      this.set('mag', this.el.mag, w?.slot === 'grenade' ? '1' : w?.slot === 'block' ? String(mag) : '∞');
      this.set('res', this.el.reserve, '');
      slash.hidden = true;
      return;
    }
    slash.hidden = false;
    this.set('mag', this.el.mag, String(mag));
    this.set('res', this.el.reserve, '∞');
    this.el.mag.classList.toggle('low', mag <= Math.ceil(w.mag * 0.2));
  }

  setMoney(m) {
    if (this.lastMoney !== null && m !== this.lastMoney) {
      const d = m - this.lastMoney;
      const el = this.el.moneyDelta;
      el.textContent = `${d > 0 ? '+' : '-'}$${Math.abs(d)}`;
      el.classList.toggle('neg', d < 0);
      el.classList.remove('show');
      void el.offsetWidth;
      el.classList.add('show');
    }
    this.lastMoney = m;
    this.set('money', this.el.money, String(m));
  }

  setInventory(me) {
    const key = JSON.stringify([me.pri, me.sec, me.gr, me.bomb, me.act, me.alive, me.blocks]);
    if (this.cache.inv === key) return;
    this.cache.inv = key;
    if (!me.alive) { this.el.inventory.innerHTML = ''; return; }
    const rows = [];
    const row = (slot, active, icons, label) => rows.push(`<div class="inv ${active ? 'active' : ''}"><kbd>${slot}</kbd><div class="inv-icons">${icons}</div><span>${label}</span></div>`);
    const img = (id, cls = '') => `<img class="${cls}" src="${weaponIcon(id)}" alt="">`;
    if (me.pri) row(1, me.act === me.pri, img(me.pri), esc(WEAPONS[me.pri].name));
    if (me.sec) row(2, me.act === me.sec, img(me.sec), esc(WEAPONS[me.sec].name));
    row(3, me.act === 'hoof', img('hoof'), 'Hoof');
    if (me.gr?.length) row(4, WEAPONS[me.act]?.slot === 'grenade', me.gr.map((g) => img(g, `nade ${g === me.act ? 'sel' : ''}`)).join(''), 'Utility');
    if (me.bomb) row(5, me.act === 'bomb', img('bomb'), 'Bomb');
    if (me.blocks > 0) row(6, me.act === 'cowblock', img('cowblock'), `Cow Block ×${me.blocks}`);
    this.el.inventory.innerHTML = rows.join('');
  }

  setTopbar(phase, secs, score, round, planted) {
    const s = Math.max(0, Math.ceil(secs));
    const txt = planted ? '' : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    this.set('timer', this.el.timer, txt);
    this.el.timer.classList.toggle('warn', phase === 'live' && s <= 10 && !planted);
    this.el.bombIcon.hidden = !planted;
    this.set('lblT', document.getElementById('scoreTLabel'), 'BULLS');
    this.set('lblCT', document.getElementById('scoreCTLabel'), 'GUARD');
    this.el.aliveT.hidden = false;
    this.el.aliveCT.hidden = false;
    this.set('scoreT', this.el.scoreT, String(score.T));
    this.set('scoreCT', this.el.scoreCT, String(score.CT));
    const label = phase === 'buy' ? `BUY PHASE · R${round}` : phase === 'end' ? 'ROUND OVER' : phase === 'over' ? 'MATCH OVER' : `ROUND ${round}`;
    this.set('round', this.el.round, label);
  }

  setAlive(roster, meId) {
    for (const team of ['T', 'CT']) {
      const list = roster.filter((p) => p.team === team);
      const html = list.map((p) => `<i class="${p.alive ? 'on' : ''} ${p.id === meId ? 'me' : ''}"></i>`).join('');
      this.set(`alive${team}`, team === 'T' ? this.el.aliveT : this.el.aliveCT, html, 'innerHTML');
    }
  }

  setMap() {
    this.radarImg = this.renderRadarMap();
  }

  setTopbarFFA(phase, secs, mine, lead, rank, mode = 'ffa') {
    const s = Math.max(0, Math.ceil(secs));
    this.set('timer', this.el.timer, `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);
    this.el.timer.classList.toggle('warn', phase === 'live' && s <= 30);
    this.el.bombIcon.hidden = true;
    this.set('scoreT', this.el.scoreT, String(mine));
    this.set('scoreCT', this.el.scoreCT, String(lead?.k ?? 0));
    this.set('lblT', document.getElementById('scoreTLabel'), 'YOU');
    this.set('lblCT', document.getElementById('scoreCTLabel'), lead ? esc(lead.name).slice(0, 10).toUpperCase() : 'LEAD');
    this.set('round', this.el.round, phase === 'buy' ? 'WARMUP · LOADOUT READY' : phase === 'over' ? 'MATCH OVER' : `RANK #${rank || '—'} · FIRST TO ${modeConfig(mode).FRAG_LIMIT}`);
    this.el.aliveT.hidden = true;
    this.el.aliveCT.hidden = true;
  }

  damageNumber(d, head) {
    const box = document.getElementById('dmgNumbers');
    const el = document.createElement('div');
    el.className = `dn ${head ? 'head' : ''}`;
    el.textContent = d;
    el.style.left = `${(Math.random() - 0.5) * 50 + 30}px`;
    el.style.top = `${(Math.random() - 0.5) * 30 - 30}px`;
    box.appendChild(el);
    setTimeout(() => el.remove(), 800);
  }

  killfeed({ killer, victim, weapon, hs, wb, me, ffa }) {
    const div = document.createElement('div');
    div.className = `kf ${me ? 'me' : ''}`;
    const k = killer ? `<span class="${ffa ? 'FFA' : killer.team}">${esc(killer.name)}</span>` : '';
    const wpn = WEAPONS[weapon] && WEAPONS[weapon].slot !== 'special' ? `<img class="kfi" src="${weaponIcon(weapon)}" alt="${esc(weaponLabel(weapon))}">` : `<span class="wpn">${esc(weaponLabel(weapon))}</span>`;
    div.innerHTML = `${k}${wpn}${wb ? '<span class="tag" title="wallbang">🧱</span>' : ''}${hs ? '<span class="tag" title="headshot">🎯</span>' : ''}<span class="${ffa ? 'FFA' : victim.team}">${esc(victim.name)}</span>`;
    this.el.killfeed.appendChild(div);
    while (this.el.killfeed.children.length > 6) this.el.killfeed.firstChild.remove();
    setTimeout(() => div.remove(), me ? 9000 : 6000);
  }

  center(text, dur = 2500, alert = false) {
    const el = this.el.center;
    el.textContent = text;
    el.classList.toggle('alert', alert);
    el.classList.add('show');
    clearTimeout(this.centerTimer);
    this.centerTimer = setTimeout(() => el.classList.remove('show'), dur);
  }

  roundBanner(winner, sub, mvp) {
    const b = this.el.banner;
    b.querySelector('.rb-title').className = `rb-title ${winner}`;
    b.querySelector('.rb-title').textContent = `${TEAMS[winner].name} win`;
    b.querySelector('.rb-sub').textContent = sub;
    b.querySelector('.rb-mvp').textContent = mvp || '';
    b.hidden = false;
    const inner = b.querySelector('.rb-inner');
    inner.style.animation = 'none';
    void inner.offsetWidth;
    inner.style.animation = '';
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => { b.hidden = true; }, 4600);
  }

  hitmarker(kill) {
    const h = this.el.hitmarker;
    h.classList.toggle('kill', !!kill);
    h.classList.remove('show');
    void h.offsetWidth;
    h.classList.add('show');
  }

  damageIndicator(rad) {
    const d = document.createElement('div');
    d.className = 'dmg-ind';
    d.style.transform = `rotate(${rad}rad)`;
    this.el.dmg.appendChild(d);
    setTimeout(() => d.remove(), 1200);
  }

  hurtFlash(amount) {
    this.el.hurt.style.opacity = String(Math.min(0.9, 0.25 + amount / 60));
    clearTimeout(this.hurtTimer);
    this.hurtTimer = setTimeout(() => { this.el.hurt.style.opacity = '0'; }, 120);
  }

  setFlash(a) { this.set('flash', this.el.flash.style, String(a.toFixed(3)), 'opacity'); }
  setSmoke(a) { this.set('smoke', this.el.smoke.style, String((a * 0.97).toFixed(3)), 'opacity'); }
  setFire(on) { this.set('fire', this.el.fire.style, on ? '1' : '0', 'opacity'); }

  progress(label, frac) {
    const p = this.el.progress;
    if (frac == null) { p.hidden = true; return; }
    p.hidden = false;
    this.set('pgl', p.querySelector('.pg-label'), label);
    p.querySelector('.pg-bar i').style.width = `${Math.min(100, frac * 100)}%`;
  }

  applyCrosshair(s) {
    const c = this.el.crosshair.style;
    c.setProperty('--col', s.crosshairColor);
    c.setProperty('--len', `${s.crosshairSize}px`);
    c.setProperty('--thick', `${s.crosshairThickness}px`);
    this.el.crosshair.classList.toggle('show-dot', !!s.crosshairDot);
    this.baseGap = s.crosshairGap;
  }

  crosshairGap(extra) {
    const g = Math.round((this.baseGap ?? 4) + extra);
    this.set('chgap', this.el.crosshair.style, `${g}px`, '--gap');
    this.el.crosshair.style.setProperty('--gap', `${g}px`);
  }

  crosshairVisible(v) { this.el.crosshair.hidden = !v; }
  scope(v) { this.el.scope.hidden = !v; }
  buyHint(v) { this.el.buyHint.hidden = !v; }
  spawnShield(v) { this.el.spawnShield.hidden = !v; }

  spectate(text) {
    if (!text) { this.el.spectate.hidden = true; return; }
    this.el.spectate.hidden = false;
    this.set('spec', this.el.spectate, text, 'innerHTML');
  }

  deathInfo(text) {
    this.el.deathInfo.hidden = !text;
    if (text) this.el.deathInfo.innerHTML = text;
  }

  netgraph(fps, ping) {
    this.set('ng', this.el.netgraph, `${fps} fps · ${Math.round(ping)} ms`);
  }

  reloadProgress(frac) {
    const el = document.getElementById('reloadRing');
    if (!el) return;
    if (frac == null) { el.hidden = true; return; }
    el.hidden = false;
    el.style.setProperty('--p', `${Math.round(Math.min(1, Math.max(0, frac)) * 360)}deg`);
  }

  countdown(text, go = false) {
    const el = document.getElementById('countdown');
    el.textContent = text;
    el.classList.toggle('go', go);
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  roundIntro(round, team, score, mode) {
    const el = document.getElementById('roundIntro');
    if (mode === 'ffa' || mode === 'duel') {
      const cfg = modeConfig(mode);
      el.querySelector('.ri-round').textContent = mode === 'duel' ? '1V1 DUEL' : 'FREE FOR ALL';
      el.querySelector('.ri-score .t').textContent = `FIRST TO ${cfg.FRAG_LIMIT}`;
      el.querySelector('.ri-score .ct').textContent = `${Math.floor(cfg.TIME / 60)}:${String(cfg.TIME % 60).padStart(2, '0')}`;
      const side = el.querySelector('.ri-side');
      side.textContent = mode === 'duel' ? 'One opponent · Build cow blocks with 6 · Stomp from above' : 'Everyone is an enemy · Spawn shield is on for a few seconds · Kills earn money · Press B to buy';
      side.className = 'ri-side';
      el.hidden = false;
      el.classList.remove('show');
      void el.offsetWidth;
      el.classList.add('show');
      clearTimeout(this.introTimer);
      this.introTimer = setTimeout(() => { el.hidden = true; }, 4500);
      return;
    }
    const half = round === 8;
    el.querySelector('.ri-round').textContent = half ? `ROUND ${round} · SECOND HALF` : `ROUND ${round}`;
    el.querySelector('.ri-score .t').textContent = `BULLS ${score.T}`;
    el.querySelector('.ri-score .ct').textContent = `${score.CT} GUARD`;
    const side = el.querySelector('.ri-side');
    side.textContent = team === 'T' ? 'ROGUE BULLS · Plant the Sour Milk Bomb at A or B' : 'DAIRY GUARD · Defend both sites';
    side.className = `ri-side ${team}`;
    el.hidden = false;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(this.introTimer);
    this.introTimer = setTimeout(() => { el.hidden = true; }, 3800);
  }

  killConfirm(name, reward, hs, streak) {
    const el = document.getElementById('killConfirm');
    const titles = ['', 'ELIMINATED', 'DOUBLE KILL', 'TRIPLE KILL', 'QUAD KILL', 'ACE'];
    const div = document.createElement('div');
    div.className = `kc ${streak >= 2 ? 'streak' : ''}`;
    div.innerHTML = `<div class="kc-title">${titles[Math.min(streak, 5)]}${hs ? ' <span class="kc-hs">HEADSHOT</span>' : ''}</div>
      <div class="kc-name">${esc(name)}</div><div class="kc-reward">+$${reward}</div>`;
    el.innerHTML = '';
    el.appendChild(div);
    clearTimeout(this.kcTimer);
    this.kcTimer = setTimeout(() => div.remove(), 2200);
  }

  // ─── Radar ────────────────────────────────────────────────
  renderRadarMap() {
    const S = 6;
    const c = document.createElement('canvas');
    this.off = -MAP.bounds.minX + 4;
    c.width = c.height = (MAP.bounds.maxX - MAP.bounds.minX + 8) * S;
    const ctx = c.getContext('2d');
    ctx.fillStyle = 'rgba(58,56,44,0.9)';
    ctx.fillRect(0, 0, c.width, c.height);
    const px = (v) => (v + this.off) * S;
    for (const s of Object.values(MAP.sites)) {
      const k = s.name;
      ctx.fillStyle = 'rgba(214,64,40,0.28)';
      ctx.fillRect(px(s.minX), px(s.minZ), (s.maxX - s.minX) * S, (s.maxZ - s.minZ) * S);
      ctx.fillStyle = 'rgba(255,120,90,0.9)';
      ctx.font = 'bold 60px Bebas Neue, Impact, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(k, px(s.center[0]), px(s.center[1]));
    }
    for (const b of MAP.boxes) {
      const tall = b.max[1] > 3;
      ctx.fillStyle = tall ? '#8a8a7e' : '#b0a888';
      ctx.fillRect(px(b.min[0]), px(b.min[2]), (b.max[0] - b.min[0]) * S, (b.max[2] - b.min[2]) * S);
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 2;
      ctx.strokeRect(px(b.min[0]), px(b.min[2]), (b.max[0] - b.min[0]) * S, (b.max[2] - b.min[2]) * S);
    }
    return c;
  }

  drawRadar(me, players, bomb) {
    const ctx = this.radarCtx;
    const W = 440, S = 4.2, IMG = 6;
    ctx.clearRect(0, 0, W, W);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, W, W);
    ctx.clip();
    ctx.translate(W / 2, W / 2);
    ctx.rotate(me.yaw);
    ctx.scale(S / IMG, S / IMG);
    ctx.translate(-(me.x + this.off) * IMG, -(me.z + this.off) * IMG);
    ctx.globalAlpha = 0.95;
    ctx.drawImage(this.radarImg, 0, 0);
    ctx.globalAlpha = 1;
    const k = IMG / S;
    const dot = (x, z, color, r, yaw) => {
      const cx = (x + this.off) * IMG, cz = (z + this.off) * IMG;
      if (yaw != null) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 3 * k;
        ctx.beginPath();
        ctx.moveTo(cx, cz);
        ctx.lineTo(cx - Math.sin(yaw) * r * 2.2, cz - Math.cos(yaw) * r * 2.2);
        ctx.stroke();
      }
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(cx, cz, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.8)';
      ctx.lineWidth = 2 * k;
      ctx.stroke();
    };
    if (bomb && (bomb.state === 'dropped' || bomb.state === 'planted')) {
      ctx.font = `${22 * k}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const cx = (bomb.x + this.off) * IMG, cz = (bomb.z + this.off) * IMG;
      ctx.save();
      ctx.translate(cx, cz);
      ctx.rotate(-me.yaw);
      ctx.fillText('💣', 0, 0);
      ctx.restore();
    }
    for (const p of players) {
      const col = p.enemy ? '#ff4b4b' : p.team === 'T' ? '#f0b75a' : '#7eb3f5';
      dot(p.x, p.z, col, 7 * k, p.enemy ? null : p.yaw);
      if (p.bomb && !p.enemy) {
        ctx.fillStyle = '#ff3030';
        ctx.fillRect((p.x + this.off) * IMG - 3 * k, (p.z + this.off) * IMG - 3 * k, 6 * k, 6 * k);
      }
    }
    if (me.alive) dot(me.x, me.z, '#ffffff', 8 * k, me.yaw);
    ctx.restore();
  }

  // ─── Buy menu ─────────────────────────────────────────────
  openBuy(onBuy) {
    this.onBuy = onBuy;
    this.el.buymenu.hidden = false;
    this.cache.buyKey = null;
  }

  closeBuy() { this.el.buymenu.hidden = true; }
  get buyOpen() { return !this.el.buymenu.hidden; }

  refreshBuy(me, team, buyLeft, ffa = false) {
    if (!this.buyOpen) return;
    this.el.bmMoney.textContent = me.m;
    this.el.bmTime.textContent = !me.buy ? 'Buying unavailable' : ffa ? 'Buy anytime · kills earn money' : `Buy time left: ${Math.ceil(buyLeft)}s`;
    const key = JSON.stringify([me.m, me.pri, me.sec, me.gr, me.ar, me.hm, me.kit, team, me.buy, ffa]);
    if (this.cache.buyKey === key) return;
    this.cache.buyKey = key;
    const grid = this.el.bmGrid;
    grid.innerHTML = '';
    for (const cat of BUY_MENU) {
      const col = document.createElement('div');
      col.className = 'bm-col';
      col.innerHTML = `<h4>${cat.cat}</h4>`;
      for (const id of cat.items) {
        const info = itemInfo(id);
        if (!ffa && info.team !== 'any' && info.team !== team) continue;
        if (ffa && id === 'kit') continue;
        const w = WEAPONS[id];
        let owned = false;
        if (w?.slot === 'primary') owned = me.pri === id;
        if (w?.slot === 'secondary') owned = me.sec === id;
        if (id === 'vest') owned = me.ar >= 100;
        if (id === 'vesthelm') owned = me.ar >= 100 && me.hm;
        if (id === 'kit') owned = me.kit;
        const price = id === 'vesthelm' && me.ar >= 100 && !me.hm ? 350 : info.price;
        const cant = !me.buy || price > me.m || owned;
        const stats = w?.damage ? `${w.damage.body} dmg · ${w.rpm} rpm · ${w.mag} rds` : w?.slot === 'grenade' ? 'Utility' : 'Equipment';
        const btn = document.createElement('button');
        btn.className = `bm-item ${cant ? 'cant' : ''} ${owned ? 'owned' : ''}`;
        btn.innerHTML = `${w ? `<img class="bmi" src="${weaponIcon(id)}" alt="">` : ''}<b>${esc(info.name)}</b><span class="bp">${price ? `$${price}` : 'FREE'}</span><span class="bs">${owned ? 'Owned' : stats}</span>`;
        btn.onclick = () => this.onBuy?.(id);
        col.appendChild(btn);
      }
      grid.appendChild(col);
    }
  }

  // ─── Scoreboard ───────────────────────────────────────────
  scoreboard(show, roster, meId, score, round, mode) {
    this.el.scoreboard.hidden = !show;
    if (!show) return;
    const ffa = mode === 'ffa' || mode === 'duel';
    document.querySelector('.sb-team.t').hidden = ffa;
    this.set('sbTitle', document.getElementById('sbTitleCT'), ffa ? (mode === 'duel' ? '1V1 DUEL' : 'FREE FOR ALL') : 'DAIRY GUARD');
    if (ffa) {
      const rows = [...roster].sort((a, b) => b.k - a.k || a.d - b.d);
      const html = rows.map((p, i) => `<tr class="${p.alive ? '' : 'dead'} ${p.id === meId ? 'me' : ''}">
        <td>${i + 1}</td><td>${esc(p.name)}${p.bot ? '<span class="bot">BOT</span>' : ''}</td><td></td>
        <td>${p.k}</td><td>${p.a}</td><td>${p.d}</td><td></td><td>${p.s}</td><td>${p.bot ? 'BOT' : p.ping}</td></tr>`).join('');
      this.set('sbCT', this.el.sbCT, html, 'innerHTML');
      this.el.sbScoreCT.textContent = rows[0]?.k ?? 0;
      this.el.sbRound.textContent = `First to ${modeConfig(mode).FRAG_LIMIT} eliminations`;
      return;
    }
    const myTeam = roster.find((p) => p.id === meId)?.team;
    for (const team of ['T', 'CT']) {
      const rows = roster.filter((p) => p.team === team).sort((a, b) => b.s - a.s || b.k - a.k);
      const html = rows.map((p) => `<tr class="${p.alive ? '' : 'dead'} ${p.id === meId ? 'me' : ''}">
        <td>${p.alive ? '' : '☠'}</td>
        <td>${esc(p.name)}${p.bot ? '<span class="bot">BOT</span>' : ''}</td>
        <td class="money">${team === myTeam ? `$${p.m}` : ''}</td>
        <td>${p.k}</td><td>${p.a}</td><td>${p.d}</td><td>${p.mvp ? `★${p.mvp}` : ''}</td><td>${p.s}</td><td>${p.bot ? 'BOT' : p.ping}</td></tr>`).join('');
      this.set(`sb${team}`, team === 'T' ? this.el.sbT : this.el.sbCT, html, 'innerHTML');
    }
    this.el.sbScoreT.textContent = score.T;
    this.el.sbScoreCT.textContent = score.CT;
    this.el.sbRound.textContent = `Round ${round} · First to 8`;
  }

  // ─── Chat ─────────────────────────────────────────────────
  addChat(m) {
    const div = document.createElement('div');
    if (m.system) {
      div.className = 'chat-line sys';
      div.textContent = m.msg;
    } else {
      div.className = 'chat-line';
      div.innerHTML = `${m.dead ? '<span style="color:#999">*DEAD* </span>' : ''}${m.teamOnly ? '<span style="color:#aaa">(TEAM) </span>' : ''}<span class="n ${m.team}">${esc(m.name)}</span>: ${esc(m.msg)}`;
    }
    this.el.chatLog.appendChild(div);
    while (this.el.chatLog.children.length > 12) this.el.chatLog.firstChild.remove();
    setTimeout(() => div.classList.add('fade'), 9000);
  }

  openChat(teamOnly, onSend, onClose) {
    this.el.chatRow.hidden = false;
    this.el.chat.classList.add('open');
    this.el.chatMode.textContent = teamOnly ? 'TEAM' : 'ALL';
    const input = this.el.chatInput;
    input.value = '';
    setTimeout(() => input.focus(), 0);
    input.onkeydown = (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        if (input.value.trim()) onSend(input.value.trim());
        this.closeChat();
        onClose();
      } else if (e.key === 'Escape') {
        this.closeChat();
        onClose();
      }
    };
  }

  closeChat() {
    this.el.chatRow.hidden = true;
    this.el.chat.classList.remove('open');
    this.el.chatInput.blur();
  }

  get chatOpen() { return !this.el.chatRow.hidden; }

  matchEnd(winner, score, ffaInfo) {
    const m = this.el.matchEnd;
    if (ffaInfo) {
      m.hidden = false;
      m.querySelector('.me-title').className = 'me-title';
      m.querySelector('.me-title').textContent = `${ffaInfo.winner || 'Nobody'} wins`;
      m.querySelector('.me-score').textContent = `${ffaInfo.kills} eliminations`;
      return;
    }
    if (!winner) { m.hidden = true; return; }
    m.hidden = false;
    m.querySelector('.me-title').className = `me-title ${winner}`;
    m.querySelector('.me-title').textContent = `${TEAMS[winner].name} win the match`;
    m.querySelector('.me-score').textContent = `${score.T} : ${score.CT}`;
  }
}
