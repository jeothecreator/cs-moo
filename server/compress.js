// Serve large text-like assets (three.js, compiled maps) brotli/gzip-compressed. Each file is
// compressed once per process and kept in memory; small files fall through to express.static.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';

const COMPRESSIBLE = /\.(js|mjs|json|glb|css|html|svg)$/;
const MIN_SIZE = 32 * 1024;
const brotli = promisify(zlib.brotliCompress), gzip = promisify(zlib.gzip);
const cache = new Map(); // `${file}:${enc}` → { tag, body: Promise<Buffer> }

function compressed(file, st, enc) {
  const key = `${file}:${enc}`;
  const tag = `W/"${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}-${enc}"`;
  let hit = cache.get(key);
  if (!hit || hit.tag !== tag) {
    const raw = fs.readFileSync(file);
    const body = enc === 'br'
      ? brotli(raw, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length } })
      : gzip(raw, { level: 9 });
    cache.set(key, (hit = { tag, body }));
  }
  return hit;
}

/** Middleware for files under `dir` (mount it on the same path as the matching express.static). */
export function precompressed(dir) {
  const base = path.resolve(dir) + path.sep;
  return async (req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    let rel;
    try { rel = decodeURIComponent(req.path); } catch { return next(); }
    if (!COMPRESSIBLE.test(rel)) return next();
    const file = path.resolve(base, '.' + rel);
    if (!file.startsWith(base)) return next();
    let st;
    try { st = fs.statSync(file); } catch { return next(); }
    if (!st.isFile() || st.size < MIN_SIZE) return next();
    const accept = String(req.headers['accept-encoding'] || '');
    const enc = /\bbr\b/.test(accept) ? 'br' : /\bgzip\b/.test(accept) ? 'gzip' : null;
    if (!enc) return next();
    const hit = compressed(file, st, enc);
    res.setHeader('Vary', 'Accept-Encoding');
    res.setHeader('ETag', hit.tag);
    res.setHeader('Cache-Control', 'no-cache');
    if (req.headers['if-none-match'] === hit.tag) return res.status(304).end();
    let body;
    try { body = await hit.body; } catch { return next(); }
    res.type(path.extname(file));
    res.setHeader('Content-Encoding', enc);
    res.setHeader('Content-Length', body.length);
    res.end(req.method === 'HEAD' ? undefined : body);
  };
}

/** Compress the big files up front so the first visitor doesn't wait on them. */
export function warm(files) {
  for (const f of files) {
    try {
      const st = fs.statSync(f);
      for (const enc of ['br', 'gzip']) compressed(f, st, enc).body.catch(() => {});
    } catch { /* missing file: nothing to warm */ }
  }
}
