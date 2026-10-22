// Procedural canvas textures — no image assets needed. Every surface is painted from seamless
// multi-octave value noise plus hand-placed detail, then gets a derived normal map.
import * as THREE from 'three';

let seed = 1337;
function rnd() {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

function canvas(w = 512, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })];
}

function toTexture(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 16; // clamped to the GPU max by three; keeps ground sharp at grazing angles
  return t;
}

const KOREAN_FONT = '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", "Noto Sans CJK KR", sans-serif';

// ─── painting helpers ─────────────────────────────────────────

// A cells×cells grid of random greys with a one-cell wrapped border. Scaling it up with
// bilinear filtering gives value noise that tiles seamlessly.
function valueNoise(cells) {
  const [c, ctx] = canvas(cells + 2);
  const img = ctx.createImageData(cells + 2, cells + 2);
  const v = Array.from({ length: cells * cells }, () => rnd() * 255);
  for (let y = 0; y < cells + 2; y++) {
    for (let x = 0; x < cells + 2; x++) {
      const val = v[((y - 1 + cells) % cells) * cells + ((x - 1 + cells) % cells)];
      const i = (y * (cells + 2) + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = val;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function cloud(ctx, w, h, cells, alpha, op = 'overlay') {
  const n = valueNoise(cells);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = op;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const sx = w / cells, sy = h / cells;
  ctx.drawImage(n, -sx, -sy, (cells + 2) * sx, (cells + 2) * sy);
  ctx.restore();
}

/** Fractal noise: several octaves of cloud() from coarse to fine. */
function fbm(ctx, w, h, { base = 4, octaves = 5, alpha = 0.5, op = 'overlay', falloff = 0.62 } = {}) {
  let a = alpha;
  for (let o = 0; o < octaves; o++) {
    cloud(ctx, w, h, base << o, a, op);
    a *= falloff;
  }
}

/** Per-pixel grain, the high-frequency texture real photographs always have. */
function grain(ctx, w, h, amount = 18) {
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rnd() - 0.5) * amount;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function shade(hex, amt) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amt);
  return `#${c.getHexString()}`;
}
function vary(hex, l = 0.06, s = 0.04) {
  const c = new THREE.Color(hex);
  c.offsetHSL((rnd() - 0.5) * 0.01, (rnd() - 0.5) * s, (rnd() - 0.5) * l);
  return `#${c.getHexString()}`;
}

function blot(ctx, x, y, r, color, alpha) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color.replace('A', String(alpha)));
  g.addColorStop(1, color.replace('A', '0'));
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}
/** blot() wrapped around all four edges so stains stay seamless. */
function blotWrap(ctx, w, h, x, y, r, color, alpha) {
  for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
    if (x + ox + r < 0 || x + ox - r > w || y + oy + r < 0 || y + oy - r > h) continue;
    blot(ctx, x + ox, y + oy, r, color, alpha);
  }
}

function streaks(ctx, w, h, count, color, { len = [0.2, 0.6], width = [1, 4], alpha = 0.18 } = {}) {
  for (let i = 0; i < count; i++) {
    const x = rnd() * w, y0 = rnd() * h * 0.6, L = h * (len[0] + rnd() * (len[1] - len[0]));
    const g = ctx.createLinearGradient(0, y0, 0, y0 + L);
    g.addColorStop(0, color.replace('A', String(alpha)));
    g.addColorStop(1, color.replace('A', '0'));
    ctx.fillStyle = g;
    ctx.fillRect(x, y0, width[0] + rnd() * (width[1] - width[0]), L);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function crack(ctx, x, y, len, color = 'rgba(0,0,0,0.45)', width = 1.2) {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x, y);
  let a = rnd() * Math.PI * 2;
  for (let i = 0; i < len; i++) {
    a += (rnd() - 0.5) * 0.9;
    x += Math.cos(a) * 6; y += Math.sin(a) * 6;
    ctx.lineTo(x, y);
    if (rnd() < 0.08) crack(ctx, x, y, len * 0.3, color, width * 0.6);
  }
  ctx.stroke();
}

/** Planks running along u. `vertical` turns them 90°. */
function planks(ctx, w, h, { count = 8, base = '#6b5843', vertical = false, gap = 'rgba(20,14,8,0.75)', grainA = 0.12, nails = true } = {}) {
  const span = vertical ? w : h;
  const pw = span / count;
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = vary(base, 0.1, 0.05);
    if (vertical) ctx.fillRect(i * pw, 0, pw, h); else ctx.fillRect(0, i * pw, w, pw);
    ctx.strokeStyle = `rgba(0,0,0,${grainA})`;
    ctx.lineWidth = 1;
    for (let g = 0; g < 9; g++) {
      const o = i * pw + rnd() * pw;
      ctx.beginPath();
      if (vertical) { ctx.moveTo(o, 0); ctx.bezierCurveTo(o + rnd() * 6 - 3, h * 0.3, o + rnd() * 6 - 3, h * 0.7, o, h); }
      else { ctx.moveTo(0, o); ctx.bezierCurveTo(w * 0.3, o + rnd() * 6 - 3, w * 0.7, o + rnd() * 6 - 3, w, o); }
      ctx.stroke();
    }
    // knots
    for (let k = 0; k < 2; k++) {
      const kx = vertical ? i * pw + pw * (0.3 + rnd() * 0.4) : rnd() * w;
      const ky = vertical ? rnd() * h : i * pw + pw * (0.3 + rnd() * 0.4);
      ctx.fillStyle = 'rgba(40,25,12,0.45)';
      ctx.beginPath(); ctx.ellipse(kx, ky, vertical ? 3 : 6, vertical ? 6 : 3, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = gap;
    if (vertical) ctx.fillRect(i * pw, 0, 2.5, h); else ctx.fillRect(0, i * pw, w, 2.5);
    if (nails) {
      ctx.fillStyle = 'rgba(25,22,20,0.8)';
      for (const t of [0.12, 0.88]) {
        if (vertical) { ctx.fillRect(i * pw + pw * 0.5 - 2, t * h, 4, 4); }
        else { ctx.fillRect(t * w, i * pw + pw * 0.5 - 2, 4, 4); }
      }
    }
  }
}

// ─── normal maps ──────────────────────────────────────────────

// Sobel the luminance of a painted canvas into a tangent-space normal map, so every
// procedural surface catches the sun with real relief instead of reading as a flat decal.
function normalFromCanvas(src, strength = 2) {
  const s = src.width, t = src.height;
  const px = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, s, t).data;
  const h = new Float32Array(s * t);
  for (let i = 0; i < s * t; i++) h[i] = (px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114) / 255;

  const [nc, nctx] = canvas(s, t);
  const out = nctx.createImageData(s, t);
  const o = out.data;
  const wx = (v) => (v + s) % s, wy = (v) => (v + t) % t;
  for (let y = 0; y < t; y++) {
    const yUp = wy(y - 1) * s, yMid = y * s, yDn = wy(y + 1) * s;
    for (let x = 0; x < s; x++) {
      const xL = wx(x - 1), xR = wx(x + 1);
      const dx = (h[yUp + xR] + 2 * h[yMid + xR] + h[yDn + xR]) - (h[yUp + xL] + 2 * h[yMid + xL] + h[yDn + xL]);
      const dy = (h[yDn + xL] + 2 * h[yDn + x] + h[yDn + xR]) - (h[yUp + xL] + 2 * h[yUp + x] + h[yUp + xR]);
      const nx = -dx * strength, ny = -dy * strength;
      const inv = 1 / Math.hypot(nx, ny, 1);
      const i = (yMid + x) * 4;
      o[i] = (nx * inv * 0.5 + 0.5) * 255;
      o[i + 1] = (ny * inv * 0.5 + 0.5) * 255;
      o[i + 2] = (inv * 0.5 + 0.5) * 255;
      o[i + 3] = 255;
    }
  }
  nctx.putImageData(out, 0, 0);
  const tx = new THREE.CanvasTexture(nc);
  tx.colorSpace = THREE.NoColorSpace; // vector data, never colour-managed
  tx.wrapS = tx.wrapT = THREE.RepeatWrapping;
  tx.anisotropy = 16;
  return tx;
}

// colour canvas → normal map. Keyed on the canvas (not the texture) because Texture.clone()
// shares .image but JSON-copies userData, which would mangle a texture stored there.
const normalMaps = new WeakMap();

/** The normal map for a colour texture, re-tiled to match if the texture repeats. */
export function normalMapFor(tex) {
  const base = tex?.image ? normalMaps.get(tex.image) : null;
  if (!base) return null;
  if (base.repeat.equals(tex.repeat) && base.offset.equals(tex.offset)) return base;
  const n = base.clone(); // shares the GPU upload through Texture.source
  n.repeat.copy(tex.repeat);
  n.offset.copy(tex.offset);
  n.needsUpdate = true;
  return n;
}

// Relief depth per surface — sandbags and planks get far more than painted render.
const RELIEF = {
  mud: 1.4, dirt: 1.6, revet: 2.4, sandbag: 3.2, bunker: 1.6, crate: 1.8, wood: 2.2, door: 2.2, metal: 2.6,
  duckboard: 2.6, asphalt: 0.9, pavers: 2.2, facade: 0.8, shop: 0.5, brick: 2.8, concrete: 1.2, rooftop: 0.8,
  steel: 0.5, parapet: 1.4, camo: 0.6, cardboard: 1.0, plaster: 0.6,
};

// ─── surfaces ─────────────────────────────────────────────────

export function makeTextures() {
  seed = 1337;
  const tex = {};

  // ── Trenches ──
  { // wet mud, boot-churned, with standing water
    const S = 1024;
    const [c, ctx] = canvas(S);
    ctx.fillStyle = '#4b3c2c'; ctx.fillRect(0, 0, S, S);
    fbm(ctx, S, S, { base: 3, octaves: 6, alpha: 0.75 });
    cloud(ctx, S, S, 6, 0.35, 'multiply');
    for (let i = 0; i < 26; i++) blotWrap(ctx, S, S, rnd() * S, rnd() * S, 40 + rnd() * 120, 'rgba(32,26,20,A)', 0.55);
    for (let i = 0; i < 14; i++) blotWrap(ctx, S, S, rnd() * S, rnd() * S, 30 + rnd() * 70, 'rgba(60,64,58,A)', 0.4); // water sheen
    for (let i = 0; i < 260; i++) { // boot prints
      const x = rnd() * S, y = rnd() * S, a = rnd() * Math.PI;
      ctx.fillStyle = 'rgba(25,19,13,0.28)';
      ctx.beginPath(); ctx.ellipse(x, y, 9, 20, a, 0, Math.PI * 2); ctx.fill();
    }
    for (let i = 0; i < 1400; i++) { // grit and pebbles
      const v = 90 + rnd() * 80;
      ctx.fillStyle = `rgba(${v},${v * 0.92},${v * 0.8},${0.25 + rnd() * 0.4})`;
      const r = 1 + rnd() * 3;
      ctx.beginPath(); ctx.arc(rnd() * S, rnd() * S, r, 0, Math.PI * 2); ctx.fill();
    }
    grain(ctx, S, S, 16);
    tex.mud = toTexture(c);
  }
  { // churned earth with dead grass — berm tops and no-man's-land
    const S = 512;
    const [c, ctx] = canvas(S);
    ctx.fillStyle = '#5a4a36'; ctx.fillRect(0, 0, S, S);
    fbm(ctx, S, S, { base: 3, octaves: 5, alpha: 0.7 });
    for (let i = 0; i < 1800; i++) {
      const x = rnd() * S, y = rnd() * S, l = 4 + rnd() * 10, a = -Math.PI / 2 + (rnd() - 0.5) * 1.2;
      ctx.strokeStyle = `rgba(${120 + rnd() * 50},${105 + rnd() * 40},${60 + rnd() * 25},${0.35 + rnd() * 0.4})`;
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
    for (let i = 0; i < 10; i++) blotWrap(ctx, S, S, rnd() * S, rnd() * S, 30 + rnd() * 60, 'rgba(35,28,20,A)', 0.45);
    grain(ctx, S, S, 14);
    tex.dirt = toTexture(c);
  }
  { // timber revetment: horizontal planks held by a post at each tile edge
    const S = 512;
    const [c, ctx] = canvas(S);
    planks(ctx, S, S, { count: 9, base: '#5d4a36', gap: 'rgba(28,20,12,0.85)', grainA: 0.16 });
    ctx.fillStyle = '#3e3022'; ctx.fillRect(0, 0, 34, S); // post
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(34, 0, 6, S);
    fbm(ctx, S, S, { base: 4, octaves: 4, alpha: 0.45 });
    for (let i = 0; i < 40; i++) blotWrap(ctx, S, S, rnd() * S, rnd() * S, 10 + rnd() * 40, 'rgba(58,44,30,A)', 0.55); // mud spatter
    streaks(ctx, S, S, 40, 'rgba(25,18,10,A)', { alpha: 0.22 });
    grain(ctx, S, S, 14);
    tex.revet = toTexture(c);
  }
  { // burlap sandbags, staggered
    const S = 512;
    const [c, ctx] = canvas(S);
    ctx.fillStyle = '#2b2419'; ctx.fillRect(0, 0, S, S);
    const rows = 5, bh = S / rows, bw = S / 2;
    for (let r = 0; r < rows; r++) {
      const off = r % 2 ? bw / 2 : 0;
      for (let k = -1; k < 3; k++) {
        const x = k * bw + off + 4, y = r * bh + 4, w = bw - 8, h = bh - 8;
        const base = vary(pick(['#8a7a58', '#94825d', '#7f7052', '#9a8a66']), 0.08);
        const g = ctx.createLinearGradient(0, y, 0, y + h);
        g.addColorStop(0, shade(base, 0.08)); g.addColorStop(0.45, base); g.addColorStop(1, shade(base, -0.2));
        ctx.fillStyle = g;
        roundRect(ctx, x, y, w, h, h * 0.42); ctx.fill();
        // tied end and seam
        ctx.strokeStyle = 'rgba(40,32,20,0.5)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(x + w * 0.88, y + h * 0.2); ctx.lineTo(x + w * 0.9, y + h * 0.8); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x + w * 0.1, y + h * 0.55); ctx.quadraticCurveTo(x + w * 0.5, y + h * 0.62, x + w * 0.82, y + h * 0.52); ctx.stroke();
      }
    }
    // burlap weave
    ctx.globalAlpha = 0.12;
    for (let y = 0; y < S; y += 3) { ctx.fillStyle = y % 6 ? '#000' : '#fff'; ctx.fillRect(0, y, S, 1); }
    for (let x = 0; x < S; x += 3) { ctx.fillStyle = x % 6 ? '#000' : '#fff'; ctx.fillRect(x, 0, 1, S); }
    ctx.globalAlpha = 1;
    fbm(ctx, S, S, { base: 4, octaves: 4, alpha: 0.4 });
    for (let i = 0; i < 18; i++) blotWrap(ctx, S, S, rnd() * S, rnd() * S, 20 + rnd() * 50, 'rgba(60,46,30,A)', 0.5);
    grain(ctx, S, S, 16);
    tex.sandbag = toTexture(c);
  }
  { // weathered bunker concrete with formwork lines and water streaks
    const S = 512;
    const [c, ctx] = canvas(S);
    ctx.fillStyle = '#8a877f'; ctx.fillRect(0, 0, S, S);
    fbm(ctx, S, S, { base: 4, octaves: 6, alpha: 0.6 });
    for (let y = S / 4; y < S; y += S / 4) { ctx.fillStyle = 'rgba(40,38,34,0.35)'; ctx.fillRect(0, y, S, 2); ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fillRect(0, y + 2, S, 1); }
    streaks(ctx, S, S, 70, 'rgba(30,28,24,A)', { alpha: 0.25, width: [2, 8] });
    for (let i = 0; i < 160; i++) { ctx.fillStyle = 'rgba(30,28,25,0.5)'; ctx.beginPath(); ctx.arc(rnd() * S, rnd() * S, 1 + rnd() * 2.5, 0, Math.PI * 2); ctx.fill(); }
    for (let i = 0; i < 6; i++) crack(ctx, rnd() * S, rnd() * S, 18);
    for (let i = 0; i < 8; i++) blotWrap(ctx, S, S, rnd() * S, S * (0.7 + rnd() * 0.3), 40 + rnd() * 60, 'rgba(70,80,50,A)', 0.25); // moss
    grain(ctx, S, S, 18);
    tex.bunker = toTexture(c);
  }
  { // olive ammo crate with stencils, rope handle and steel corners
    const S = 512;
    const [c, ctx] = canvas(S);
    planks(ctx, S, S, { count: 4, base: '#4d5326', gap: 'rgba(15,16,6,0.8)', grainA: 0.14, nails: false });
    fbm(ctx, S, S, { base: 4, octaves: 4, alpha: 0.35 });
    ctx.strokeStyle = '#2e3216'; ctx.lineWidth = 26; ctx.strokeRect(13, 13, S - 26, S - 26);
    ctx.fillStyle = '#5a5c56';
    for (const [x, y] of [[0, 0], [S - 60, 0], [0, S - 60], [S - 60, S - 60]]) ctx.fillRect(x, y, 60, 60);
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    for (const [x, y] of [[20, 20], [S - 40, 20], [20, S - 40], [S - 40, S - 40]]) { ctx.beginPath(); ctx.arc(x + 10, y + 10, 5, 0, Math.PI * 2); ctx.fill(); }
    ctx.fillStyle = 'rgba(232,214,140,0.85)';
    ctx.font = 'bold 64px "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('7.62MM', S / 2, S * 0.38);
    ctx.font = 'bold 40px "Courier New", monospace';
    ctx.fillText('AMMUNITION', S / 2, S * 0.5);
    ctx.font = 'bold 26px "Courier New", monospace';
    ctx.fillText('LOT 44-17  1200 CTG', S / 2, S * 0.6);
    ctx.strokeStyle = '#a08a5c'; ctx.lineWidth = 10; // rope handle
    ctx.beginPath(); ctx.moveTo(S * 0.38, S * 0.78); ctx.quadraticCurveTo(S * 0.5, S * 0.9, S * 0.62, S * 0.78); ctx.stroke();
    for (let i = 0; i < 20; i++) blotWrap(ctx, S, S, rnd() * S, rnd() * S, 10 + rnd() * 40, 'rgba(30,26,16,A)', 0.4);
    grain(ctx, S, S, 14);
    tex.crate = toTexture(c);
  }
  { // grey weathered planks
    const S = 512;
    const [c, ctx] = canvas(S);
    planks(ctx, S, S, { count: 6, base: '#7b6c5a', vertical: true, grainA: 0.18 });
    fbm(ctx, S, S, { base: 4, octaves: 4, alpha: 0.4 });
    grain(ctx, S, S, 14);
    tex.wood = toTexture(c);
  }
  { // plank barricade: vertical boards, Z brace
    const S = 512;
    const [c, ctx] = canvas(S);
    planks(ctx, S, S, { count: 5, base: '#6a5640', vertical: true, grainA: 0.16 });
    ctx.fillStyle = '#4c3b29';
    ctx.fillRect(0, S * 0.12, S, 46); ctx.fillRect(0, S * 0.8, S, 46);
    ctx.save(); ctx.translate(S / 2, S / 2); ctx.rotate(-0.62); ctx.fillRect(-S * 0.7, -22, S * 1.4, 44); ctx.restore();
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(0, S * 0.12 + 44, S, 4); ctx.fillRect(0, S * 0.8 + 44, S, 4);
    fbm(ctx, S, S, { base: 4, octaves: 4, alpha: 0.4 });
    grain(ctx, S, S, 14);
    tex.door = toTexture(c);
  }
  { // rusted corrugated iron
    const S = 512;
    const [c, ctx] = canvas(S);
    const ribs = 16;
    for (let x = 0; x < S; x++) {
      const k = 0.5 + 0.5 * Math.sin((x / S) * ribs * Math.PI * 2);
      const v = 80 + k * 70;
      ctx.fillStyle = `rgb(${v},${v * 0.98},${v * 0.92})`;
      ctx.fillRect(x, 0, 1, S);
    }
    // Rust grows in organic patches: an fbm mask, smoothstepped, cuts a rust layer.
    const [rc, rctx] = canvas(S);
    rctx.fillStyle = '#7a3f1d'; rctx.fillRect(0, 0, S, S);
    fbm(rctx, S, S, { base: 3, octaves: 5, alpha: 0.8 });
    const [mc, mctx] = canvas(S);
    mctx.fillStyle = '#808080'; mctx.fillRect(0, 0, S, S);
    fbm(mctx, S, S, { base: 2, octaves: 6, alpha: 1, op: 'source-over', falloff: 0.55 });
    const mask = mctx.getImageData(0, 0, S, S), rust = rctx.getImageData(0, 0, S, S);
    for (let i = 0; i < mask.data.length; i += 4) {
      const t = Math.min(1, Math.max(0, (mask.data[i] / 255 - 0.42) / 0.22));
      rust.data[i + 3] = 255 * t * t * (3 - 2 * t);
    }
    rctx.putImageData(rust, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.globalAlpha = 0.9;
    ctx.drawImage(rc, 0, 0);
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    streaks(ctx, S, S, 60, 'rgba(90,40,15,A)', { alpha: 0.3, width: [2, 6] });
    grain(ctx, S, S, 16);
    tex.metal = toTexture(c);
  }
  { // duckboard slats
    const [c, ctx] = canvas(256);
    ctx.fillStyle = '#1e1810'; ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 6; i++) {
      ctx.fillStyle = vary('#6e5a42', 0.1);
      ctx.fillRect(0, i * 42.6 + 6, 256, 32);
    }
    fbm(ctx, 256, 256, { base: 4, octaves: 4, alpha: 0.4 });
    grain(ctx, 256, 256, 14);
    tex.duckboard = toTexture(c);
  }

  // ── Seoul ──
  { // wet asphalt with aggregate, patches and cracks
    const S = 1024;
    const [c, ctx] = canvas(S);
    ctx.fillStyle = '#3a3c3e'; ctx.fillRect(0, 0, S, S);
    fbm(ctx, S, S, { base: 4, octaves: 6, alpha: 0.4 });
    for (let i = 0; i < 9; i++) { ctx.fillStyle = vary('#353739', 0.05); ctx.fillRect(rnd() * S, rnd() * S, 80 + rnd() * 200, 60 + rnd() * 160); }
    for (let i = 0; i < 9000; i++) { const v = 100 + rnd() * 90; ctx.fillStyle = `rgba(${v},${v},${v},${0.2 + rnd() * 0.3})`; ctx.fillRect(rnd() * S, rnd() * S, 1.5, 1.5); }
    for (let i = 0; i < 10; i++) crack(ctx, rnd() * S, rnd() * S, 30, 'rgba(10,10,10,0.55)', 1.6);
    for (let i = 0; i < 12; i++) blotWrap(ctx, S, S, rnd() * S, rnd() * S, 30 + rnd() * 70, 'rgba(15,15,18,A)', 0.4); // oil
    grain(ctx, S, S, 14);
    tex.asphalt = toTexture(c);
  }
  { // Korean interlocking pavers
    const S = 512;
    const [c, ctx] = canvas(S);
    ctx.fillStyle = '#5c5751'; ctx.fillRect(0, 0, S, S);
    const bw = S / 8, bh = S / 16;
    for (let r = 0; r < 16; r++) {
      for (let k = -1; k < 9; k++) {
        const x = k * bw + (r % 2 ? bw / 2 : 0);
        ctx.fillStyle = vary(pick(['#9a9590', '#8f8a84', '#a39a92', '#8e6f60']), 0.06);
        ctx.fillRect(x + 1.5, r * bh + 1.5, bw - 3, bh - 3);
      }
    }
    fbm(ctx, S, S, { base: 4, octaves: 5, alpha: 0.35 });
    for (let i = 0; i < 10; i++) blotWrap(ctx, S, S, rnd() * S, rnd() * S, 20 + rnd() * 50, 'rgba(30,30,30,A)', 0.3);
    grain(ctx, S, S, 14);
    tex.pavers = toTexture(c);
  }
  { // apartment facade: 4 bays × 4 storeys (24 m × 12 m) so the window pattern doesn't visibly repeat.
    // A separate emissive mask lights a random third of the windows in mixed warm / cool tones.
    const W = 1024, H = 512, bw = W / 4, sh = H / 4;
    const [c, ctx] = canvas(W, H);
    const [gc, gctx] = canvas(W, H);
    gctx.fillStyle = '#000'; gctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#ada190'; ctx.fillRect(0, 0, W, H);
    for (let y = 0; y < H; y += 8) for (let x = (y / 8) % 2 ? -12 : 0; x < W; x += 24) { ctx.fillStyle = vary('#aa9e8b', 0.03); ctx.fillRect(x + 1, y + 1, 22, 6); }
    fbm(ctx, W, H, { base: 4, octaves: 4, alpha: 0.3 });
    for (let f = 0; f < 4; f++) {
      ctx.fillStyle = 'rgba(55,50,45,0.4)'; ctx.fillRect(0, (f + 1) * sh - 10, W, 10); // slab band
      for (let bay = 0; bay < 4; bay++) {
        const x = bay * bw + 34, y = f * sh + 22, w = bw - 68, h = sh - 52;
        ctx.fillStyle = '#d4d1ca'; ctx.fillRect(x - 5, y - 5, w + 10, h + 10);
        const lit = rnd() < 0.34;
        const tone = pick(['#ffcf8a', '#ffe2b0', '#fff2dc', '#cfe2ff', '#ffd9a8']);
        const g = ctx.createLinearGradient(x, y, x, y + h);
        g.addColorStop(0, lit ? tone : '#2e3a46'); g.addColorStop(1, lit ? shade(tone, -0.25) : '#161d24');
        ctx.fillStyle = g; ctx.fillRect(x, y, w, h);
        ctx.fillStyle = '#d4d1ca'; ctx.fillRect(x + w / 2 - 3, y, 6, h);
        const blind = rnd();
        if (blind < 0.5) { ctx.fillStyle = lit ? 'rgba(235,225,205,0.75)' : 'rgba(150,145,135,0.6)'; ctx.fillRect(x, y, w, h * (0.2 + rnd() * 0.6)); }
        if (lit) {
          gctx.fillStyle = tone; gctx.globalAlpha = 0.55 + rnd() * 0.45; gctx.fillRect(x, y, w, h); gctx.globalAlpha = 1;
          gctx.fillStyle = '#000'; gctx.fillRect(x + w / 2 - 3, y, 6, h);
          if (blind < 0.5) { gctx.fillStyle = 'rgba(0,0,0,0.55)'; gctx.fillRect(x, y, w, h * 0.4); }
        }
        if (rnd() < 0.45) { // outdoor AC unit under the window
          ctx.fillStyle = '#e4e2dc'; ctx.fillRect(x + w * 0.62, y + h + 6, 46, 26);
          ctx.fillStyle = '#8f9192'; ctx.beginPath(); ctx.arc(x + w * 0.62 + 23, y + h + 19, 9, 0, Math.PI * 2); ctx.fill();
        }
      }
    }
    streaks(ctx, W, H, 60, 'rgba(40,36,30,A)', { alpha: 0.2 });
    grain(ctx, W, H, 12);
    tex.facade = toTexture(c);
    tex.facadeGlow = toTexture(gc);
  }
  { // ground-floor storefront (6 m × 4.2 m): glass, shutter, signboard band
    const W = 1024, H = 720;
    const [c, ctx] = canvas(W, H);
    const [gc, gctx] = canvas(W, H);
    gctx.fillStyle = '#000'; gctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#2b2d30'; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#1a1b1d'; ctx.fillRect(0, 0, W, 150); // sign band (signs are separate meshes)
    const glass = ctx.createLinearGradient(0, 170, 0, H);
    glass.addColorStop(0, '#f0e6cf'); glass.addColorStop(1, '#bba987');
    ctx.fillStyle = glass; ctx.fillRect(40, 170, W - 80, H - 230);
    gctx.fillStyle = '#ffe9c4'; gctx.fillRect(40, 170, W - 80, H - 230);
    // shelves seen through the glass
    for (let y = 260; y < H - 80; y += 90) {
      ctx.fillStyle = '#7a6e5f'; ctx.fillRect(60, y, W - 120, 8);
      for (let x = 70; x < W - 70; x += 14 + rnd() * 10) { ctx.fillStyle = `hsl(${rnd() * 360},55%,${45 + rnd() * 20}%)`; ctx.fillRect(x, y - 40 - rnd() * 20, 10, 40); }
    }
    gctx.globalAlpha = 0.35; gctx.drawImage(c, 0, 0); gctx.globalAlpha = 1;
    // half-raised roller shutter on the left bay
    for (let y = 170; y < 360; y += 10) { ctx.fillStyle = y % 20 ? '#8b8e91' : '#7a7d80'; ctx.fillRect(40, y, W * 0.45, 10); }
    gctx.fillStyle = '#000'; gctx.fillRect(40, 170, W * 0.45, 190);
    ctx.fillStyle = '#3a3c3f';
    for (const x of [40, W / 2 - 10, W - 60]) ctx.fillRect(x, 170, 20, H - 230);
    ctx.fillRect(0, H - 60, W, 60);
    streaks(ctx, W, H, 30, 'rgba(0,0,0,A)', { alpha: 0.15 });
    grain(ctx, W, H, 10);
    tex.shop = toTexture(c);
    tex.shopGlow = toTexture(gc);
  }
  { // red-brown brick
    const S = 512;
    const [c, ctx] = canvas(S);
    ctx.fillStyle = '#8e8a82'; ctx.fillRect(0, 0, S, S);
    const rows = 16, bh = S / rows, bw = S / 4;
    for (let r = 0; r < rows; r++) {
      for (let k = -1; k < 5; k++) {
        const x = k * bw + (r % 2 ? bw / 2 : 0);
        ctx.fillStyle = vary(pick(['#8b4a32', '#7c3f2b', '#94573c', '#6f3828']), 0.08);
        ctx.fillRect(x + 2, r * bh + 2, bw - 4, bh - 4);
      }
    }
    fbm(ctx, S, S, { base: 4, octaves: 5, alpha: 0.4 });
    streaks(ctx, S, S, 30, 'rgba(20,20,20,A)', { alpha: 0.18 });
    grain(ctx, S, S, 16);
    tex.brick = toTexture(c);
  }
  { // smooth cast concrete
    const S = 512;
    const [c, ctx] = canvas(S);
    ctx.fillStyle = '#a7a39b'; ctx.fillRect(0, 0, S, S);
    fbm(ctx, S, S, { base: 4, octaves: 6, alpha: 0.4 });
    for (let i = 0; i < 90; i++) { ctx.fillStyle = 'rgba(60,58,54,0.45)'; ctx.beginPath(); ctx.arc(rnd() * S, rnd() * S, 0.8 + rnd() * 1.8, 0, Math.PI * 2); ctx.fill(); }
    streaks(ctx, S, S, 30, 'rgba(40,38,34,A)', { alpha: 0.18 });
    for (let i = 0; i < 3; i++) crack(ctx, rnd() * S, rnd() * S, 14, 'rgba(0,0,0,0.3)');
    grain(ctx, S, S, 14);
    tex.concrete = toTexture(c);
  }
  { // green urethane rooftop coating — the classic Seoul rooftop
    const S = 1024;
    const [c, ctx] = canvas(S);
    ctx.fillStyle = '#4c7f5a'; ctx.fillRect(0, 0, S, S);
    fbm(ctx, S, S, { base: 3, octaves: 5, alpha: 0.35 });
    for (let i = 0; i < 40; i++) blotWrap(ctx, S, S, rnd() * S, rnd() * S, 20 + rnd() * 90, 'rgba(70,60,50,A)', 0.3); // dust and scuffs
    for (let i = 0; i < 12; i++) crack(ctx, rnd() * S, rnd() * S, 22, 'rgba(30,40,30,0.5)');
    for (let i = 0; i < 6; i++) blotWrap(ctx, S, S, rnd() * S, rnd() * S, 60 + rnd() * 80, 'rgba(40,60,45,A)', 0.4); // old puddles
    grain(ctx, S, S, 12);
    tex.rooftop = toTexture(c);
  }
  { // brushed stainless / painted steel
    const S = 256;
    const [c, ctx] = canvas(S);
    ctx.fillStyle = '#b9bdc0'; ctx.fillRect(0, 0, S, S);
    for (let y = 0; y < S; y++) { ctx.fillStyle = `rgba(255,255,255,${rnd() * 0.12})`; ctx.fillRect(0, y, S, 1); }
    fbm(ctx, S, S, { base: 4, octaves: 3, alpha: 0.2 });
    streaks(ctx, S, S, 16, 'rgba(60,50,40,A)', { alpha: 0.15 });
    tex.steel = toTexture(c);
  }
  { // concrete parapet coping
    const S = 256;
    const [c, ctx] = canvas(S);
    ctx.fillStyle = '#c7c2b8'; ctx.fillRect(0, 0, S, S);
    fbm(ctx, S, S, { base: 4, octaves: 5, alpha: 0.35 });
    streaks(ctx, S, S, 20, 'rgba(40,38,34,A)', { alpha: 0.3 });
    grain(ctx, S, S, 12);
    tex.parapet = toTexture(c);
  }
  { // woodland camouflage for gear and the barricade
    const S = 256;
    const [c, ctx] = canvas(S);
    ctx.fillStyle = '#6a6a48'; ctx.fillRect(0, 0, S, S);
    for (const col of ['#4c4f33', '#2f2c22', '#7d7350']) {
      ctx.fillStyle = col;
      for (let i = 0; i < 16; i++) { ctx.beginPath(); ctx.ellipse(rnd() * S, rnd() * S, 10 + rnd() * 22, 6 + rnd() * 12, rnd() * 3, 0, Math.PI * 2); ctx.fill(); }
    }
    grain(ctx, S, S, 12);
    tex.camo = toTexture(c);
  }

  { // delivery cardboard, taped, with shipping labels
    const S = 512;
    const [c, ctx] = canvas(S);
    ctx.fillStyle = '#a9824f'; ctx.fillRect(0, 0, S, S);
    for (let x = 0; x < S; x += 4) { ctx.fillStyle = `rgba(80,55,25,${0.04 + rnd() * 0.05})`; ctx.fillRect(x, 0, 2, S); }
    fbm(ctx, S, S, { base: 4, octaves: 4, alpha: 0.3 });
    ctx.strokeStyle = 'rgba(70,48,22,0.6)'; ctx.lineWidth = 4; ctx.strokeRect(2, 2, S - 4, S - 4);
    ctx.fillStyle = 'rgba(205,185,140,0.85)'; ctx.fillRect(S * 0.44, 0, S * 0.12, S); // tape
    ctx.fillStyle = '#f2f0ea'; ctx.fillRect(S * 0.08, S * 0.62, S * 0.3, S * 0.2); // label
    ctx.fillStyle = '#222';
    for (let i = 0; i < 5; i++) ctx.fillRect(S * 0.1, S * 0.65 + i * 14, S * (0.12 + rnd() * 0.12), 5);
    for (let i = 0; i < 18; i++) ctx.fillRect(S * 0.27 + i * 3, S * 0.64, 2, S * 0.08);
    ctx.font = `900 54px ${KOREAN_FONT}`; ctx.fillStyle = 'rgba(40,30,20,0.6)'; ctx.textAlign = 'center';
    ctx.fillText('취급주의', S * 0.72, S * 0.3); // "handle with care"
    grain(ctx, S, S, 12);
    tex.cardboard = toTexture(c);
  }
  { // interior plaster
    const S = 256;
    const [c, ctx] = canvas(S);
    ctx.fillStyle = '#d6d0c4'; ctx.fillRect(0, 0, S, S);
    fbm(ctx, S, S, { base: 4, octaves: 4, alpha: 0.25 });
    grain(ctx, S, S, 8);
    tex.plaster = toTexture(c);
  }
  { // chain-link fence (alpha-tested)
    const S = 256;
    const [c, ctx] = canvas(S);
    ctx.clearRect(0, 0, S, S);
    ctx.strokeStyle = '#c3c7c9'; ctx.lineWidth = 3;
    const step = S / 8;
    for (let i = -8; i < 16; i++) {
      ctx.beginPath(); ctx.moveTo(i * step, 0); ctx.lineTo(i * step + S, S); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i * step + S, 0); ctx.lineTo(i * step, S); ctx.stroke();
    }
    tex.fence = toTexture(c);
  }

  for (const [k, strength] of Object.entries(RELIEF)) {
    if (tex[k]?.image) normalMaps.set(tex[k].image, normalFromCanvas(tex[k].image, strength));
  }
  return tex;
}

/** Shop / street signage. Neon signs glow through bloom; panel signs are lit boxes. */
export function signTexture(text, { bg = '#14161a', fg = '#ffffff', glow = null, w = 1024, h = 256, font = KOREAN_FONT, weight = 900, border = null } = {}) {
  const [c, ctx] = canvas(w, h);
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);
  if (border) { ctx.strokeStyle = border; ctx.lineWidth = 14; ctx.strokeRect(10, 10, w - 20, h - 20); }
  let size = h * 0.62;
  ctx.font = `${weight} ${size}px ${font}`;
  while (ctx.measureText(text).width > w * 0.88 && size > 20) { size -= 4; ctx.font = `${weight} ${size}px ${font}`; }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (glow) { ctx.shadowColor = glow; ctx.shadowBlur = h * 0.18; }
  ctx.fillStyle = fg;
  ctx.fillText(text, w / 2, h / 2 + h * 0.04);
  ctx.shadowBlur = 0;
  const t = toTexture(c, false);
  t.anisotropy = 8;
  return t;
}

/** Vending machine front: lit display of drinks, buttons, coin slot. */
export function vendingTexture(hue = 205) {
  const [c, ctx] = canvas(256, 512);
  ctx.fillStyle = `hsl(${hue},60%,38%)`; ctx.fillRect(0, 0, 256, 512);
  ctx.fillStyle = '#e9eef2'; ctx.fillRect(18, 30, 220, 300);
  for (let r = 0; r < 4; r++) {
    for (let k = 0; k < 6; k++) {
      ctx.fillStyle = `hsl(${(k * 57 + r * 31) % 360},70%,52%)`;
      roundRect(ctx, 28 + k * 35, 48 + r * 72, 26, 50, 6); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillRect(32 + k * 35, 54 + r * 72, 5, 36);
      ctx.fillStyle = '#c62828'; ctx.fillRect(31 + k * 35, 102 + r * 72, 20, 7);
    }
    ctx.fillStyle = '#b0b8bf'; ctx.fillRect(18, 108 + r * 72, 220, 4);
  }
  ctx.fillStyle = '#1b1d20'; ctx.fillRect(40, 400, 176, 60);
  ctx.fillStyle = '#9aa3aa'; ctx.fillRect(196, 350, 24, 36);
  return toTexture(c, false);
}

export function spriteTexture() {
  const [c, ctx] = canvas(64);
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return toTexture(c, false);
}

export function smokePuffTexture() {
  const [c, ctx] = canvas(128);
  for (let i = 0; i < 16; i++) {
    const x = 32 + rnd() * 64, y = 32 + rnd() * 64, r = 18 + rnd() * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  }
  return toTexture(c, false);
}

export function splatTexture(color = '255,255,255') {
  const [c, ctx] = canvas(128);
  ctx.fillStyle = `rgba(${color},0.95)`;
  ctx.beginPath(); ctx.arc(64, 64, 22, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 14; i++) {
    const a = rnd() * Math.PI * 2, d = 20 + rnd() * 36, r = 3 + rnd() * 9;
    ctx.beginPath(); ctx.arc(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, r, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(64, 64); ctx.lineWidth = r; ctx.strokeStyle = `rgba(${color},0.9)`; ctx.lineTo(64 + Math.cos(a) * d, 64 + Math.sin(a) * d); ctx.stroke();
  }
  return toTexture(c, false);
}

export function textTexture(text, { font = 'bold 200px Bebas Neue, Impact, sans-serif', color = 'rgba(255,255,255,0.8)', size = 256 } = {}) {
  const [c, ctx] = canvas(size);
  ctx.fillStyle = color;
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size / 2, size / 2 + 10);
  return toTexture(c, false);
}

export function labelTexture(text, color = '#ffffff') {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const ctx = c.getContext('2d');
  ctx.font = 'bold 30px Rajdhani, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.strokeText(text, 128, 32);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 32);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
