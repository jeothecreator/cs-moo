// Fully procedural WebAudio sound design with simple positional panning.

const SHOTS = {
  ak: { body: [900, 0.24, 1.0], crack: 0.55, thump: [120, 40, 0.16, 1.0], squirt: 0.35 },
  mooster: { body: [1800, 0.1, 0.45], crack: 0.12, thump: [90, 50, 0.08, 0.35], squirt: 0.25 },
  milkyway: { body: [1400, 0.11, 0.6], crack: 0.3, thump: [150, 60, 0.08, 0.5], squirt: 0.3 },
  udder9: { body: [1600, 0.13, 0.7], crack: 0.4, thump: [170, 70, 0.1, 0.6], squirt: 0.3 },
  deag: { body: [700, 0.32, 1.1], crack: 0.7, thump: [95, 35, 0.26, 1.2], squirt: 0.35 },
  pasteurizer: { body: [1100, 0.38, 1.2], crack: 0.4, thump: [75, 30, 0.3, 1.3], squirt: 0.5, lowpass: true },
  creaminator: { body: [600, 0.6, 1.3], crack: 0.9, thump: [60, 25, 0.45, 1.4], squirt: 0.4, reverb: 0.5 },
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.volume = 0.6;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.voices = true;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master.connect(comp).connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // reverb
    const irLen = ctx.sampleRate * 1.8;
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < irLen; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.22;
    this.reverb.connect(this.reverbGain).connect(this.master);
  }

  setVolume(v) {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  setListener(x, y, z, yaw) {
    this.listener.x = x; this.listener.y = y; this.listener.z = z; this.listener.yaw = yaw;
  }

  // Output chain for a sound at pos (null = 2D).
  out(pos, { range = 12, reverb = 0.15 } = {}) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    if (!pos) {
      g.connect(this.master);
      if (reverb > 0) { const r = ctx.createGain(); r.gain.value = reverb * 0.5; g.connect(r).connect(this.reverb); }
      return g;
    }
    const L = this.listener;
    const dx = pos[0] - L.x, dy = pos[1] - L.y, dz = pos[2] - L.z;
    const dist = Math.hypot(dx, dy, dz);
    const gain = 1 / (1 + Math.pow(dist / range, 1.4));
    const rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
    const pan = dist > 0.1 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / Math.hypot(dx, dz || 1e-3) )) : 0;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = Math.max(700, 18000 / (1 + dist / 18));
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan * 0.85;
    const vol = ctx.createGain();
    vol.gain.value = gain;
    g.connect(lp).connect(panner).connect(vol).connect(this.master);
    const r = ctx.createGain();
    r.gain.value = reverb * Math.min(1, 0.3 + dist / 40);
    vol.connect(r).connect(this.reverb);
    return g;
  }

  noise(dest, t, dur, { type = 'bandpass', freq = 1000, freqEnd = null, Q = 1, gain = 1, attack = 0.002 } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = Q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(dest);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  tone(dest, t, dur, { type = 'sine', freq = 440, freqEnd = null, gain = 0.5, attack = 0.003 } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  get ok() { return !!this.ctx; }

  shot(weapon, pos = null) {
    if (!this.ok) return;
    const p = SHOTS[weapon] || SHOTS.udder9;
    const t = this.ctx.currentTime;
    const o = this.out(pos, { range: 22, reverb: p.reverb ?? 0.2 });
    this.noise(o, t, p.body[1], { type: p.lowpass ? 'lowpass' : 'bandpass', freq: p.body[0], freqEnd: p.body[0] * 0.5, Q: 0.7, gain: p.body[2] });
    if (p.crack) this.noise(o, t, 0.05, { type: 'highpass', freq: 3000, gain: p.crack });
    this.tone(o, t, p.thump[2], { freq: p.thump[0], freqEnd: p.thump[1], gain: p.thump[3] });
    this.noise(o, t + 0.01, 0.12, { type: 'bandpass', freq: 2600, freqEnd: 500, Q: 2, gain: p.squirt });
  }

  dryFire() {
    if (!this.ok) return;
    const t = this.ctx.currentTime, o = this.out(null, { reverb: 0 });
    this.tone(o, t, 0.03, { type: 'square', freq: 1800, gain: 0.08 });
  }

  /** Reload sounds timed to the viewmodel stages: release, slide out, drop, insert, seat, rack. */
  reload(dur, style = 'mag') {
    if (!this.ok) return;
    const t = this.ctx.currentTime, o = this.out(null, { reverb: 0 });
    const click = (at, f, g = 0.22) => {
      this.noise(o, t + at, 0.04, { type: 'highpass', freq: 2600, gain: g });
      this.tone(o, t + at, 0.025, { type: 'square', freq: f, gain: 0.06 });
    };
    if (style === 'shell') {
      this.noise(o, t + dur * 0.5, 0.06, { type: 'bandpass', freq: 1800, Q: 3, gain: 0.25 });
      click(dur * 0.62, 900, 0.18);
      return;
    }
    click(dur * 0.12, 1100);
    this.noise(o, t + dur * 0.16, 0.18, { type: 'bandpass', freq: 900, freqEnd: 500, Q: 2, gain: 0.14 });
    this.noise(o, t + dur * 0.42, 0.08, { type: 'lowpass', freq: 500, gain: 0.22 });
    this.noise(o, t + dur * 0.5, 0.2, { type: 'bandpass', freq: 700, freqEnd: 1400, Q: 2, gain: 0.12 });
    click(dur * 0.7, 1400, 0.3);
    this.noise(o, t + dur * 0.78, 0.07, { type: 'highpass', freq: 1800, gain: 0.28 });
    click(dur * (style === 'pistol' ? 0.86 : 0.88), 1700, 0.3);
  }

  pump() {
    if (!this.ok) return;
    const t = this.ctx.currentTime, o = this.out(null, { reverb: 0.05 });
    this.noise(o, t, 0.09, { type: 'bandpass', freq: 1200, Q: 1.5, gain: 0.35 });
    this.noise(o, t + 0.16, 0.08, { type: 'bandpass', freq: 1600, Q: 1.5, gain: 0.35 });
  }

  blockPlace(pos) {
    if (!this.ok) return;
    const t = this.ctx.currentTime, o = this.out(pos, { range: 10, reverb: 0.1 });
    this.noise(o, t, 0.08, { type: 'lowpass', freq: 600, gain: 0.45 });
    this.tone(o, t, 0.12, { type: 'triangle', freq: 420, freqEnd: 260, gain: 0.2 });
  }

  blockBreak(pos) {
    if (!this.ok) return;
    const t = this.ctx.currentTime, o = this.out(pos, { range: 12, reverb: 0.15 });
    this.noise(o, t, 0.25, { type: 'bandpass', freq: 900, freqEnd: 300, Q: 0.8, gain: 0.5 });
    for (let i = 0; i < 5; i++) this.noise(o, t + 0.03 + i * 0.04, 0.03, { type: 'highpass', freq: 2500 + i * 300, gain: 0.12 });
  }

  stomp(pos) {
    if (!this.ok) return;
    const t = this.ctx.currentTime, o = this.out(pos, { range: 14, reverb: 0.2 });
    this.tone(o, t, 0.25, { type: 'sine', freq: 180, freqEnd: 620, gain: 0.45 });
    this.noise(o, t, 0.12, { type: 'lowpass', freq: 700, gain: 0.5 });
  }

  draw() {
    if (!this.ok) return;
    const t = this.ctx.currentTime, o = this.out(null, { reverb: 0 });
    this.noise(o, t, 0.15, { type: 'bandpass', freq: 1500, freqEnd: 3500, Q: 2, gain: 0.12 });
    this.tone(o, t + 0.12, 0.03, { type: 'square', freq: 1200, gain: 0.05 });
  }

  footstep(pos, soft = false) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const o = this.out(pos, { range: 7, reverb: 0.05 });
    this.noise(o, t, 0.08, { type: 'bandpass', freq: 380 + Math.random() * 180, Q: 1.3, gain: soft ? 0.12 : 0.35 });
    this.noise(o, t, 0.03, { type: 'highpass', freq: 4000, gain: soft ? 0.03 : 0.08 });
  }

  land(pos) {
    if (!this.ok) return;
    const t = this.ctx.currentTime, o = this.out(pos, { range: 8 });
    this.noise(o, t, 0.12, { type: 'lowpass', freq: 500, gain: 0.5 });
  }

  hit(headshot, kill) {
    if (!this.ok) return;
    const t = this.ctx.currentTime, o = this.out(null, { reverb: 0 });
    if (headshot) {
      this.tone(o, t, 0.25, { freq: 3100, gain: 0.25 });
      this.tone(o, t, 0.2, { freq: 4650, gain: 0.12 });
    } else {
      this.tone(o, t, 0.05, { type: 'triangle', freq: 2000, gain: 0.25 });
    }
    if (kill) this.tone(o, t + 0.06, 0.14, { type: 'triangle', freq: 1300, gain: 0.2 });
  }

  hurt() {
    if (!this.ok) return;
    const t = this.ctx.currentTime, o = this.out(null, { reverb: 0 });
    this.tone(o, t, 0.15, { freq: 190, freqEnd: 80, gain: 0.5 });
    this.noise(o, t, 0.1, { type: 'lowpass', freq: 800, gain: 0.35 });
  }

  // Soft milk-splat / thud. The old sawtooth moo stacked on every FFA kill.
  death(pos = null, local = false) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const o = this.out(pos, { range: local ? 16 : 9, reverb: 0.12 });
    const g = local ? 0.28 : 0.16;
    this.noise(o, t, 0.22, { type: 'lowpass', freq: 420, freqEnd: 90, Q: 0.6, gain: g, attack: 0.004 });
    this.tone(o, t, 0.18, { type: 'sine', freq: 92, freqEnd: 42, gain: g * 0.7 });
    this.noise(o, t + 0.02, 0.12, { type: 'bandpass', freq: 900, freqEnd: 280, Q: 1.1, gain: g * 0.45 });
  }

  moo(pos, pitch = 1) {
    if (!this.ok) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = this.out(pos, { range: 10, reverb: 0.18 });
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const base = (165 + Math.random() * 18) * pitch;
    osc.frequency.setValueAtTime(base * 1.05, t);
    osc.frequency.linearRampToValueAtTime(base * 0.82, t + 0.35);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(0.12, t + 0.05);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 900;
    osc.connect(lp).connect(env).connect(o);
    osc.start(t);
    osc.stop(t + 0.5);
  }

  swing(pos) {
    if (!this.ok) return;
    const t = this.ctx.currentTime, o = this.out(pos, { range: 6 });
    this.noise(o, t, 0.18, { type: 'bandpass', freq: 700, freqEnd: 3200, Q: 1.5, gain: 0.3 });
  }

  throw(pos) {
    if (!this.ok) return;
    const t = this.ctx.currentTime, o = this.out(pos, { range: 8 });
    this.noise(o, t, 0.25, { type: 'bandpass', freq: 500, freqEnd: 1800, Q: 1, gain: 0.25 });
  }

  boom(type, pos) {
    if (!this.ok) return;
    const t = this.ctx.currentTime;
    const o = this.out(pos, { range: 30, reverb: 0.5 });
    if (type === 'he') {
      this.noise(o, t, 1.3, { type: 'lowpass', freq: 1400, freqEnd: 120, gain: 1.6 });
      this.tone(o, t, 0.7, { freq: 70, freqEnd: 28, gain: 1.4 });
      this.noise(o, t, 0.08, { type: 'highpass', freq: 2500, gain: 0.8 });
    } else if (type === 'butter') {
      this.noise(o, t, 0.3, { type: 'highpass', freq: 1800, gain: 1.1 });
      this.tone(o, t, 0.08, { type: 'square', freq: 1500, gain: 0.3 });
    } else if (type === 'smoke') {
      this.noise(o, t, 2.8, { type: 'bandpass', freq: 1500, freqEnd: 350, Q: 0.6, gain: 0.45, attack: 0.05 });
    } else if (type === 'molotov') {
      this.noise(o, t, 0.1, { type: 'highpass', freq: 3000, gain: 0.6 });
      this.noise(o, t + 0.02, 1.2, { type: 'lowpass', freq: 900, freqEnd: 300, gain: 0.9, attack: 0.08 });
      for (let i = 0; i < 26; i++) this.noise(o, t + 0.2 + Math.random() * 2.5, 0.02, { type: 'highpass', freq: 3000 + Math.random() * 3000, gain: 0.15 });
    } else if (type === 'fizzle') {
      this.noise(o, t, 0.9, { type: 'highpass', freq: 4000, freqEnd: 1500, gain: 0.35 });
    } else if (type === 'bomb') {
      this.noise(o, t, 3, { type: 'lowpass', freq: 900, freqEnd: 60, gain: 2.2, attack: 0.01 });
      this.tone(o, t, 1.6, { freq: 55, freqEnd: 20, gain: 2 });
    }
  }

  bounce(pos) {
    if (!this.ok) return;
    const t = this.ctx.currentTime, o = this.out(pos, { range: 6 });
    this.tone(o, t, 0.04, { type: 'triangle', freq: 700 + Math.random() * 300, gain: 0.15 });
  }

  tinnitus(dur) {
    if (!this.ok) return;
    const t = this.ctx.currentTime, o = this.out(null, { reverb: 0 });
    this.tone(o, t, dur, { freq: 3600, gain: 0.07, attack: 0.05 });
  }

  beep(pos) {
    if (!this.ok) return;
    const t = this.ctx.currentTime, o = this.out(pos, { range: 18, reverb: 0.2 });
    this.tone(o, t, 0.09, { freq: 2350, gain: 0.4 });
  }

  defuseTick() {
    if (!this.ok) return;
    const t = this.ctx.currentTime, o = this.out(null, { reverb: 0 });
    this.tone(o, t, 0.02, { type: 'square', freq: 3000, gain: 0.05 });
  }

  buy() {
    if (!this.ok) return;
    const t = this.ctx.currentTime, o = this.out(null, { reverb: 0.1 });
    this.noise(o, t, 0.06, { type: 'highpass', freq: 5000, gain: 0.2 });
    this.tone(o, t + 0.03, 0.12, { type: 'triangle', freq: 1318, gain: 0.2 });
    this.tone(o, t + 0.1, 0.25, { type: 'triangle', freq: 1760, gain: 0.2 });
  }

  click() {
    if (!this.ok) return;
    const t = this.ctx.currentTime, o = this.out(null, { reverb: 0 });
    this.tone(o, t, 0.03, { freq: 900, gain: 0.1 });
  }

  radio() {
    if (!this.ok) return;
    const t = this.ctx.currentTime, o = this.out(null, { reverb: 0 });
    this.noise(o, t, 0.12, { type: 'bandpass', freq: 2000, Q: 4, gain: 0.25 });
    this.tone(o, t + 0.1, 0.06, { type: 'square', freq: 1400, gain: 0.08 });
  }

  jingle(win) {
    if (!this.ok) return;
    const t = this.ctx.currentTime, o = this.out(null, { reverb: 0.4 });
    const notes = win ? [523, 659, 784, 1046] : [392, 349, 311, 262];
    notes.forEach((f, i) => this.tone(o, t + i * 0.12, 0.5, { type: 'triangle', freq: f, gain: 0.22 }));
  }

  count(go) {
    if (!this.ok) return;
    const t = this.ctx.currentTime, o = this.out(null, { reverb: 0.15 });
    if (go) {
      this.tone(o, t, 0.45, { type: 'triangle', freq: 880, gain: 0.3 });
      this.tone(o, t, 0.45, { type: 'triangle', freq: 1318, gain: 0.2 });
      this.noise(o, t, 0.3, { type: 'bandpass', freq: 2000, Q: 3, gain: 0.15 });
    } else {
      this.tone(o, t, 0.14, { type: 'triangle', freq: 660, gain: 0.28 });
    }
  }

  killConfirm(streak = 1) {
    if (!this.ok) return;
    const t = this.ctx.currentTime, o = this.out(null, { reverb: 0.1 });
    const base = 700 + Math.min(streak, 5) * 140;
    this.tone(o, t, 0.12, { type: 'square', freq: base, gain: 0.07 });
    this.tone(o, t + 0.07, 0.22, { type: 'triangle', freq: base * 1.5, gain: 0.18 });
  }

  say(text) {
    if (!this.voices || !('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      u.pitch = 0.7;
      u.volume = Math.min(1, this.volume * 1.2);
      window.speechSynthesis.speak(u);
    } catch { /* speech unavailable */ }
  }
}
