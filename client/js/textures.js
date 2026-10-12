// Procedural canvas textures — no external image assets needed.
import * as THREE from 'three';

let seed = 1337;
function rnd() {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}

function canvas(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')];
}

function noise(ctx, size, amount, alpha = 0.08, scale = 2) {
  for (let i = 0; i < amount; i++) {
    const v = Math.floor(rnd() * 255);
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    ctx.fillRect(rnd() * size, rnd() * size, scale * (0.5 + rnd()), scale * (0.5 + rnd()));
  }
}

function shade(hex, amt) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, amt);
  return `#${c.getHexString()}`;
}

function toTexture(c, repeat = true) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 16; // clamped to the GPU max by three; keeps ground sharp at grazing angles
  return t;
}

// Sobel the luminance of a painted canvas into a tangent-space normal map, so every
// procedural surface catches the sun with real relief instead of reading as a flat decal.
// Looked up via normalMapFor(); see the WeakMap below.
function normalFromCanvas(src, strength = 2) {
  const s = src.width;
  const px = src.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, s, s).data;
  const h = new Float32Array(s * s);
  for (let i = 0; i < s * s; i++) h[i] = (px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114) / 255;

  const [nc, nctx] = canvas(s);
  const out = nctx.createImageData(s, s);
  const o = out.data;
  const wrap = (v) => (v + s) % s;
  for (let y = 0; y < s; y++) {
    const yUp = wrap(y - 1) * s, yMid = y * s, yDn = wrap(y + 1) * s;
    for (let x = 0; x < s; x++) {
      const xL = wrap(x - 1), xR = wrap(x + 1);
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
  const t = new THREE.CanvasTexture(nc);
  t.colorSpace = THREE.NoColorSpace; // vector data, never colour-managed
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 16;
  return t;
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

// Relief depth per surface — rough masonry and straw get far more than sheet metal.
const RELIEF = {
  barn: 2.4, door: 2.0, wood: 2.0, crate: 2.2, hay: 3.0, concrete: 1.3, brick: 3.0,
  stone: 1.6, metal: 0.8, tank: 0.6, ground: 1.2, roof: 2.6, holstein: 0.5, bull: 0.5,
};

const painters = {
  planks(ctx, s, base, vertical = true, count = 8) {
    const w = s / count;
    for (let i = 0; i < count; i++) {
      ctx.fillStyle = shade(base, (rnd() - 0.5) * 0.08);
      if (vertical) ctx.fillRect(i * w, 0, w, s); else ctx.fillRect(0, i * w, s, w);
      // grain
      ctx.strokeStyle = 'rgba(0,0,0,0.12)';
      ctx.lineWidth = 1;
      for (let g = 0; g < 7; g++) {
        ctx.beginPath();
        const o = i * w + rnd() * w;
        if (vertical) { ctx.moveTo(o, 0); ctx.bezierCurveTo(o + rnd() * 6 - 3, s * 0.3, o + rnd() * 6 - 3, s * 0.7, o, s); } else { ctx.moveTo(0, o); ctx.bezierCurveTo(s * 0.3, o + rnd() * 6 - 3, s * 0.7, o + rnd() * 6 - 3, s, o); }
        ctx.stroke();
      }
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      if (vertical) ctx.fillRect(i * w, 0, 3, s); else ctx.fillRect(0, i * w, s, 3);
      // nails
      ctx.fillStyle = 'rgba(30,30,30,0.7)';
      for (const y of [0.08, 0.92]) {
        if (vertical) { ctx.fillRect(i * w + w * 0.3, y * s, 4, 4); ctx.fillRect(i * w + w * 0.7, y * s, 4, 4); }
      }
    }
    noise(ctx, s, 5000, 0.05);
  },
};

export function makeTextures() {
  const tex = {};

  // Red barn wood
  {
    const [c, ctx] = canvas(512);
    painters.planks(ctx, 512, '#8e2b22', true, 8);
    // weathering
    const g = ctx.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, 'rgba(255,255,255,0.05)'); g.addColorStop(1, 'rgba(40,20,0,0.25)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 60; i++) { ctx.fillStyle = `rgba(210,190,160,${rnd() * 0.12})`; ctx.fillRect(rnd() * 512, rnd() * 512, rnd() * 40, rnd() * 5); }
    tex.barn = toTexture(c);
  }
  // Weathered barn door wood
  {
    const [c, ctx] = canvas(512);
    painters.planks(ctx, 512, '#7a5a3a', false, 6);
    ctx.strokeStyle = '#3c2a18'; ctx.lineWidth = 22;
    ctx.strokeRect(11, 11, 490, 490);
    ctx.beginPath(); ctx.moveTo(20, 20); ctx.lineTo(492, 492); ctx.stroke();
    tex.door = toTexture(c);
  }
  // Shed planks
  {
    const [c, ctx] = canvas(512);
    painters.planks(ctx, 512, '#9c7a52', true, 6);
    tex.wood = toTexture(c);
  }
  // Crate
  {
    const [c, ctx] = canvas(256);
    painters.planks(ctx, 256, '#b58a4f', false, 5);
    ctx.strokeStyle = '#6b4a24'; ctx.lineWidth = 20;
    ctx.strokeRect(10, 10, 236, 236);
    ctx.lineWidth = 16;
    ctx.beginPath(); ctx.moveTo(18, 18); ctx.lineTo(238, 238); ctx.stroke();
    ctx.fillStyle = 'rgba(40,20,10,0.55)';
    ctx.font = 'bold 30px sans-serif';
    ctx.fillText('MOO', 150, 60);
    tex.crate = toTexture(c);
  }
  // Hay
  {
    const [c, ctx] = canvas(256);
    ctx.fillStyle = '#c9a54a'; ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 2200; i++) {
      const x = rnd() * 256, y = rnd() * 256, l = 6 + rnd() * 18, a = (rnd() - 0.5) * 0.9;
      ctx.strokeStyle = rnd() < 0.5 ? `rgba(240,210,120,${0.5 + rnd() * 0.5})` : `rgba(140,100,30,${0.3 + rnd() * 0.4})`;
      ctx.lineWidth = 1 + rnd();
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(90,60,20,0.8)';
    ctx.fillRect(0, 70, 256, 6); ctx.fillRect(0, 180, 256, 6);
    tex.hay = toTexture(c);
  }
  // Concrete
  {
    const [c, ctx] = canvas(512);
    ctx.fillStyle = '#a9a59b'; ctx.fillRect(0, 0, 512, 512);
    noise(ctx, 512, 20000, 0.06, 3);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(60,55,45,${rnd() * 0.08})`;
      ctx.beginPath(); ctx.arc(rnd() * 512, rnd() * 512, 20 + rnd() * 60, 0, Math.PI * 2); ctx.fill();
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.25)'; ctx.lineWidth = 2;
    ctx.strokeRect(0, 0, 512, 512);
    ctx.beginPath(); ctx.moveTo(0, 256); ctx.lineTo(512, 256); ctx.stroke();
    const g = ctx.createLinearGradient(0, 380, 0, 512);
    g.addColorStop(0, 'rgba(60,50,30,0)'); g.addColorStop(1, 'rgba(60,50,30,0.25)');
    ctx.fillStyle = g; ctx.fillRect(0, 380, 512, 132);
    tex.concrete = toTexture(c);
  }
  // Brick
  {
    const [c, ctx] = canvas(512);
    ctx.fillStyle = '#6d6a62'; ctx.fillRect(0, 0, 512, 512);
    const bh = 32, bw = 96;
    for (let row = 0; row < 16; row++) {
      for (let col = -1; col < 7; col++) {
        const x = col * bw + (row % 2 ? bw / 2 : 0);
        ctx.fillStyle = shade('#9b4d36', (rnd() - 0.5) * 0.12);
        ctx.fillRect(x + 3, row * bh + 3, bw - 6, bh - 6);
      }
    }
    noise(ctx, 512, 12000, 0.07, 2);
    tex.brick = toTexture(c);
  }
  // Fieldstone perimeter
  {
    const [c, ctx] = canvas(512);
    ctx.fillStyle = '#4e4a44'; ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 90; i++) {
      const x = rnd() * 512, y = rnd() * 512, r = 26 + rnd() * 34;
      ctx.fillStyle = shade('#8d877c', (rnd() - 0.5) * 0.2);
      ctx.beginPath(); ctx.ellipse(x, y, r, r * (0.6 + rnd() * 0.3), rnd() * 3, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.beginPath(); ctx.ellipse(x - r * 0.2, y - r * 0.2, r * 0.5, r * 0.3, 0, 0, Math.PI * 2); ctx.fill();
    }
    noise(ctx, 512, 15000, 0.06, 2);
    tex.stone = toTexture(c);
  }
  // Corrugated metal
  {
    const [c, ctx] = canvas(256);
    for (let x = 0; x < 256; x++) {
      const v = 0.5 + 0.5 * Math.sin((x / 256) * Math.PI * 24);
      const l = Math.floor(70 + v * 60);
      ctx.fillStyle = `rgb(${l * 0.55},${l * 0.8},${l * 0.75})`;
      ctx.fillRect(x, 0, 1, 256);
    }
    for (let i = 0; i < 40; i++) { ctx.fillStyle = `rgba(120,60,20,${rnd() * 0.25})`; ctx.beginPath(); ctx.arc(rnd() * 256, rnd() * 256, rnd() * 18, 0, 7); ctx.fill(); }
    tex.metal = toTexture(c);
  }
  // Stainless milk tank
  {
    const [c, ctx] = canvas(256);
    const g = ctx.createLinearGradient(0, 0, 256, 0);
    for (let i = 0; i <= 8; i++) g.addColorStop(i / 8, i % 2 ? '#e8eef2' : '#9aa4ab');
    ctx.fillStyle = g; ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#2d6fb7'; ctx.fillRect(0, 100, 256, 50);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 34px sans-serif'; ctx.fillText('MILK', 80, 138);
    noise(ctx, 256, 3000, 0.04);
    tex.tank = toTexture(c);
  }
  // Ground: packed dirt with grass patches
  {
    const [c, ctx] = canvas(1024);
    ctx.fillStyle = '#7b6a4c'; ctx.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 260; i++) {
      ctx.fillStyle = rnd() < 0.55 ? `rgba(92,120,58,${0.15 + rnd() * 0.3})` : `rgba(60,48,32,${0.1 + rnd() * 0.2})`;
      ctx.beginPath(); ctx.arc(rnd() * 1024, rnd() * 1024, 20 + rnd() * 90, 0, Math.PI * 2); ctx.fill();
    }
    noise(ctx, 1024, 60000, 0.07, 2);
    for (let i = 0; i < 5000; i++) {
      const x = rnd() * 1024, y = rnd() * 1024;
      ctx.strokeStyle = `rgba(${100 + rnd() * 40},${130 + rnd() * 50},60,${0.35})`;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + rnd() * 4 - 2, y - 4 - rnd() * 6); ctx.stroke();
    }
    for (let i = 0; i < 300; i++) { ctx.fillStyle = `rgba(160,150,130,${0.4 + rnd() * 0.4})`; ctx.beginPath(); ctx.arc(rnd() * 1024, rnd() * 1024, 1 + rnd() * 3, 0, 7); ctx.fill(); }
    tex.ground = toTexture(c);
  }
  // Roof shingles
  {
    const [c, ctx] = canvas(256);
    ctx.fillStyle = '#3a3230'; ctx.fillRect(0, 0, 256, 256);
    for (let row = 0; row < 8; row++) for (let col = -1; col < 9; col++) {
      ctx.fillStyle = shade('#56463f', (rnd() - 0.5) * 0.1);
      ctx.fillRect(col * 32 + (row % 2) * 16 + 1, row * 32 + 1, 30, 30);
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(col * 32 + (row % 2) * 16, row * 32 + 28, 32, 4);
    }
    tex.roof = toTexture(c);
  }
  // Holstein spots
  {
    const [c, ctx] = canvas(256);
    ctx.fillStyle = '#f4f1ea'; ctx.fillRect(0, 0, 256, 256);
    ctx.fillStyle = '#1c1c1e';
    for (let i = 0; i < 9; i++) {
      const x = rnd() * 256, y = rnd() * 256;
      ctx.beginPath();
      for (let a = 0; a < Math.PI * 2; a += 0.5) {
        const r = 18 + rnd() * 22;
        ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      ctx.fill();
    }
    tex.holstein = toTexture(c);
  }
  // Brown bull fur
  {
    const [c, ctx] = canvas(256);
    ctx.fillStyle = '#6b3f22'; ctx.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 3000; i++) {
      ctx.strokeStyle = rnd() < 0.5 ? 'rgba(40,20,10,0.25)' : 'rgba(150,95,55,0.25)';
      const x = rnd() * 256, y = rnd() * 256;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + rnd() * 3, y + 4 + rnd() * 5); ctx.stroke();
    }
    tex.bull = toTexture(c);
  }
  // Camo fabric for vests
  {
    const [c, ctx] = canvas(128);
    ctx.fillStyle = '#34495e'; ctx.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 40; i++) { ctx.fillStyle = rnd() < 0.5 ? '#2c3e50' : '#4a6178'; ctx.beginPath(); ctx.ellipse(rnd() * 128, rnd() * 128, 8 + rnd() * 12, 4 + rnd() * 8, rnd() * 3, 0, 7); ctx.fill(); }
    tex.camoCT = toTexture(c);
    const [c2, ctx2] = canvas(128);
    ctx2.fillStyle = '#5a4a32'; ctx2.fillRect(0, 0, 128, 128);
    for (let i = 0; i < 40; i++) { ctx2.fillStyle = rnd() < 0.5 ? '#3d3122' : '#7a6444'; ctx2.beginPath(); ctx2.ellipse(rnd() * 128, rnd() * 128, 8 + rnd() * 12, 4 + rnd() * 8, rnd() * 3, 0, 7); ctx2.fill(); }
    tex.camoT = toTexture(c2);
  }

  for (const [k, strength] of Object.entries(RELIEF)) {
    if (tex[k]?.image) normalMaps.set(tex[k].image, normalFromCanvas(tex[k].image, strength));
  }
  return tex;
}

/** Soft round sprite used for particles. */
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
