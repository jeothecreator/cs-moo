// Valve Map Format (Hammer .vmf) reader: tokenises the KeyValues tree and turns brushes into
// convex polygons (each side's plane clipped by every other side), plus displacement grids.

/** Parse VMF text into nested { key, props, children } nodes. */
export function parseVMF(text) {
  const root = { key: 'root', props: {}, children: [] };
  const stack = [root];
  let pendingKey = null;
  const re = /"((?:[^"\\]|\\.)*)"\s+"((?:[^"\\]|\\.)*)"|([A-Za-z_][\w]*)|(\{)|(\})/g;
  let m;
  while ((m = re.exec(text))) {
    const top = stack[stack.length - 1];
    if (m[1] !== undefined) {
      const k = m[1];
      if (top.props[k] === undefined) top.props[k] = m[2];
      else (top.multi ||= {})[k] = [...(top.multi?.[k] || [top.props[k]]), m[2]];
    } else if (m[3] !== undefined) pendingKey = m[3];
    else if (m[4]) {
      const node = { key: pendingKey || '', props: {}, children: [] };
      top.children.push(node);
      stack.push(node);
      pendingKey = null;
    } else if (m[5]) stack.pop();
  }
  return root;
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

export function parsePoints(str) {
  return [...str.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim().split(/\s+/).map(Number));
}

/** Plane with an outward normal (Hammer winds the three points clockwise seen from outside). */
export function planeFrom(points) {
  const [p1, p2, p3] = points;
  const n = norm(cross(sub(p3, p1), sub(p2, p1)));
  return { n, d: dot(n, p1) };
}

function clipPoly(poly, plane, eps = 1e-3) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    const da = dot(plane.n, a) - plane.d, db = dot(plane.n, b) - plane.d;
    if (da <= eps) out.push(a);
    if ((da <= eps) !== (db <= eps)) {
      const t = da / (da - db);
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return out;
}

/** Faces of a convex brush: for each side, a huge quad on its plane clipped by the others. */
export function brushFaces(sides) {
  const planes = sides.map((s) => planeFrom(parsePoints(s.props.plane)));
  const faces = [];
  planes.forEach((pl, i) => {
    const n = pl.n;
    const up = Math.abs(n[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    const u = norm(cross(up, n)), v = cross(n, u);
    const c = [n[0] * pl.d, n[1] * pl.d, n[2] * pl.d], S = 65536;
    // counter-clockwise seen from outside (along +n)
    let poly = [
      [c[0] - u[0] * S - v[0] * S, c[1] - u[1] * S - v[1] * S, c[2] - u[2] * S - v[2] * S],
      [c[0] + u[0] * S - v[0] * S, c[1] + u[1] * S - v[1] * S, c[2] + u[2] * S - v[2] * S],
      [c[0] + u[0] * S + v[0] * S, c[1] + u[1] * S + v[1] * S, c[2] + u[2] * S + v[2] * S],
      [c[0] - u[0] * S + v[0] * S, c[1] - u[1] * S + v[1] * S, c[2] - u[2] * S + v[2] * S],
    ];
    planes.forEach((other, j) => { if (j !== i && poly.length) poly = clipPoly(poly, other); });
    if (poly.length >= 3) faces.push({ side: sides[i], plane: pl, poly });
  });
  return faces;
}

export const vec = { sub, cross, dot, norm };
