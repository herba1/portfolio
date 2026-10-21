const TIERS = [
  { gap: 10, edge: 9, lift: 0.07, pack: 0.3 },
  { gap: 6, edge: 5.5, lift: 0.04, pack: 0.5 },
  { gap: 3.9, edge: 3.6, lift: 0.022, pack: 0.8 },
  { gap: 2.6, edge: 2.4, lift: 0.013, pack: 1.5 },
  { gap: 1.8, edge: 1.7, lift: 0.008, pack: 2 },
  { gap: 1.25, edge: 1.2, lift: 0.005, pack: 2.4 },
];
const GHOST = 4;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ease = (x) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

function circle(px, py, a, b, c) {
  const ax = px[a];
  const ay = py[a];
  const bx = px[b];
  const by = py[b];
  const cx = px[c];
  const cy = py[c];
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  const a2 = ax * ax + ay * ay;
  const b2 = bx * bx + by * by;
  const c2 = cx * cx + cy * cy;
  const x = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const y = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  return { a, b, c, x, y, r2: (ax - x) * (ax - x) + (ay - y) * (ay - y) };
}

function insert(tris, px, py, p) {
  const keep = [];
  const edges = new Map();
  for (const t of tris) {
    const dx = px[p] - t.x;
    const dy = py[p] - t.y;
    if (dx * dx + dy * dy < t.r2 * (1 - 1e-9)) {
      for (const [u, v] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]]) {
        const key = u < v ? u * 65536 + v : v * 65536 + u;
        if (edges.has(key)) edges.delete(key);
        else edges.set(key, [u, v]);
      }
    } else keep.push(t);
  }
  for (const [u, v] of edges.values()) keep.push(circle(px, py, u, v, p));
  return keep;
}

export function createFacets({ nx, ny, sub, seed = 23 }) {
  const rand = rng(seed);
  const W = nx - 1;
  const H = ny - 1;
  const RX = W * sub + 1;
  const RY = H * sub + 1;
  const RN = RX * RY;
  const px = [];
  const py = [];
  const tier = [];
  const sign = [];
  const add = (x, y, t) => {
    px.push(x);
    py.push(y);
    tier.push(t);
    sign.push(rand() < 0.5 ? -1 : 1);
  };
  const clear = (x, y, gap) => {
    for (let q = GHOST; q < px.length; q += 1) {
      const dx = px[q] - x;
      const dy = py[q] - y;
      if (dx * dx + dy * dy < gap * gap) return false;
    }
    return true;
  };
  const big = (W + H) * 6;
  add(-big, -big, -1);
  add(W + big, -big, -1);
  add(W + big, H + big, -1);
  add(-big, H + big, -1);
  let tris = [circle(px, py, 0, 1, 2), circle(px, py, 0, 2, 3)];
  for (const [x, y] of [[0, 0], [W, 0], [W, H], [0, H]]) add(x, y, 0);
  for (let q = GHOST; q < px.length; q += 1) tris = insert(tris, px, py, q);

  function locate(list) {
    const idx = new Uint16Array(RN * 3);
    const wts = new Float32Array(RN * 3);
    const hit = new Uint8Array(RN);
    for (const t of list) {
      const ax = px[t.a];
      const ay = py[t.a];
      const bx = px[t.b];
      const by = py[t.b];
      const cx = px[t.c];
      const cy = py[t.c];
      const det = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(det) < 1e-9) continue;
      const i0 = Math.max(0, Math.floor(Math.min(ax, bx, cx) * sub));
      const i1 = Math.min(RX - 1, Math.ceil(Math.max(ax, bx, cx) * sub));
      const j0 = Math.max(0, Math.floor(Math.min(ay, by, cy) * sub));
      const j1 = Math.min(RY - 1, Math.ceil(Math.max(ay, by, cy) * sub));
      for (let j = j0; j <= j1; j += 1) {
        for (let i = i0; i <= i1; i += 1) {
          const n = j * RX + i;
          if (hit[n]) continue;
          const x = i / sub;
          const y = j / sub;
          const l0 = ((by - cy) * (x - cx) + (cx - bx) * (y - cy)) / det;
          const l1 = ((cy - ay) * (x - cx) + (ax - cx) * (y - cy)) / det;
          const l2 = 1 - l0 - l1;
          if (l0 < -1e-6 || l1 < -1e-6 || l2 < -1e-6) continue;
          hit[n] = 1;
          idx[n * 3] = t.a;
          idx[n * 3 + 1] = t.b;
          idx[n * 3 + 2] = t.c;
          wts[n * 3] = l0;
          wts[n * 3 + 1] = l1;
          wts[n * 3 + 2] = l2;
        }
      }
    }
    return { idx, wts, hit };
  }

  const levels = TIERS.map((spec, ti) => {
    const first = px.length;
    for (const [len, put] of [
      [W, (s) => [s, 0]],
      [W, (s) => [s, H]],
      [H, (s) => [0, s]],
      [H, (s) => [W, s]],
    ]) {
      const n = Math.max(1, Math.round(len / spec.edge));
      for (let s = 1; s < n; s += 1) {
        const [x, y] = put(((s + (rand() - 0.5) * 0.6) / n) * len);
        if (clear(x, y, spec.edge * 0.7)) add(x, y, ti);
      }
    }
    const tries = Math.round(((W * H) / (spec.gap * spec.gap)) * 30);
    for (let k = 0; k < tries; k += 1) {
      const x = 0.5 + rand() * (W - 1);
      const y = 0.5 + rand() * (H - 1);
      if (clear(x, y, spec.gap)) add(x, y, ti);
    }
    for (let q = first; q < px.length; q += 1) tris = insert(tris, px, py, q);
    return locate(tris.filter((t) => t.a >= GHOST && t.b >= GHOST && t.c >= GHOST));
  });

  const count = px.length;
  const corner = new Float32Array(count * 3);

  function sample(field, x, y, out, k) {
    const i0 = Math.min(nx - 2, Math.max(0, Math.floor(x)));
    const j0 = Math.min(ny - 2, Math.max(0, Math.floor(y)));
    const tx = x - i0;
    const ty = y - j0;
    const a = (j0 * nx + i0) * 3;
    const b = a + 3;
    const c = a + nx * 3;
    const d = c + 3;
    const w00 = (1 - tx) * (1 - ty);
    const w10 = tx * (1 - ty);
    const w01 = (1 - tx) * ty;
    const w11 = tx * ty;
    for (let q = 0; q < 3; q += 1) out[k + q] = field[a + q] * w00 + field[b + q] * w10 + field[c + q] * w01 + field[d + q] * w11;
  }

  const nrm = [0, 0, 0];

  function apply(position, pose, normals, level, relief, pack) {
    const L = Math.min(TIERS.length, Math.max(0, level));
    if (L <= 1e-4) return;
    const top = Math.min(TIERS.length, Math.ceil(L - 1e-6));
    const frac = ease(L - (top - 1));
    for (let q = GHOST; q < count; q += 1) {
      const t = tier[q];
      if (t > top - 1) continue;
      const k = q * 3;
      sample(pose, px[q], py[q], corner, k);
      sample(normals, px[q], py[q], nrm, 0);
      const len = Math.hypot(nrm[0], nrm[1], nrm[2]) || 1;
      const on = Math.min(1, Math.max(0, L - t));
      const spec = TIERS[t];
      const lift = (spec.lift * sign[q] * relief * on * (1 + (spec.pack - 1) * pack)) / len;
      corner[k] += nrm[0] * lift;
      corner[k + 1] += nrm[1] * lift;
      corner[k + 2] += nrm[2] * lift;
    }
    const cur = levels[top - 1];
    const prev = top > 1 ? levels[top - 2] : null;
    for (let n = 0; n < RN; n += 1) {
      if (!cur.hit[n]) continue;
      const k = n * 3;
      const a = cur.idx[k] * 3;
      const b = cur.idx[k + 1] * 3;
      const c = cur.idx[k + 2] * 3;
      const wa = cur.wts[k];
      const wb = cur.wts[k + 1];
      const wc = cur.wts[k + 2];
      let fx = position[k];
      let fy = position[k + 1];
      let fz = position[k + 2];
      if (prev && prev.hit[n]) {
        const pa = prev.idx[k] * 3;
        const pb = prev.idx[k + 1] * 3;
        const pc = prev.idx[k + 2] * 3;
        const va = prev.wts[k];
        const vb = prev.wts[k + 1];
        const vc = prev.wts[k + 2];
        fx = corner[pa] * va + corner[pb] * vb + corner[pc] * vc;
        fy = corner[pa + 1] * va + corner[pb + 1] * vb + corner[pc + 1] * vc;
        fz = corner[pa + 2] * va + corner[pb + 2] * vb + corner[pc + 2] * vc;
      }
      const ox = corner[a] * wa + corner[b] * wb + corner[c] * wc;
      const oy = corner[a + 1] * wa + corner[b + 1] * wb + corner[c + 1] * wc;
      const oz = corner[a + 2] * wa + corner[b + 2] * wb + corner[c + 2] * wc;
      position[k] = fx + (ox - fx) * frac;
      position[k + 1] = fy + (oy - fy) * frac;
      position[k + 2] = fz + (oz - fz) * frac;
    }
  }

  return { apply };
}
