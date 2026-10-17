export const BLOCK_W = 640;
export const BLOCK_H = 800;

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const smooth = (a, b, x) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

function hash2(x, y, seed) {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function valueNoise(x, y, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function boxBlur(src, w, h, r) {
  if (r < 1) return Float32Array.from(src);
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const norm = 1 / (2 * r + 1);
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    let acc = src[row] * (r + 1);
    for (let i = 1; i <= r; i += 1) acc += src[row + (i < w ? i : w - 1)];
    for (let x = 0; x < w; x += 1) {
      tmp[row + x] = acc * norm;
      const add = x + r + 1;
      const sub = x - r;
      acc += src[row + (add < w ? add : w - 1)] - src[row + (sub > 0 ? sub : 0)];
    }
  }
  const acc = new Float32Array(w);
  for (let x = 0; x < w; x += 1) acc[x] = tmp[x] * (r + 1);
  for (let i = 1; i <= r; i += 1) {
    const row = (i < h ? i : h - 1) * w;
    for (let x = 0; x < w; x += 1) acc[x] += tmp[row + x];
  }
  for (let y = 0; y < h; y += 1) {
    const row = y * w;
    const add = y + r + 1;
    const sub = y - r;
    const addRow = (add < h ? add : h - 1) * w;
    const subRow = (sub > 0 ? sub : 0) * w;
    for (let x = 0; x < w; x += 1) {
      out[row + x] = acc[x] * norm;
      acc[x] += tmp[addRow + x] - tmp[subRow + x];
    }
  }
  return out;
}

function blur(src, w, h, r) {
  const a = Math.max(1, Math.round(r * 0.75));
  return boxBlur(boxBlur(boxBlur(src, w, h, a), w, h, a), w, h, a);
}

function normalise(g) {
  const bins = new Uint32Array(1024);
  for (let i = 0; i < g.length; i += 1) bins[Math.min(1023, Math.max(0, Math.floor(g[i] * 1023)))] += 1;
  const pick = (q) => {
    let acc = 0;
    const want = g.length * q;
    for (let b = 0; b < 1024; b += 1) {
      acc += bins[b];
      if (acc >= want) return b / 1023;
    }
    return 1;
  };
  const lo = pick(0.015);
  const hi = pick(0.985);
  const span = Math.max(1e-3, hi - lo);
  const out = new Float32Array(g.length);
  for (let i = 0; i < g.length; i += 1) out[i] = clamp01((g[i] - lo) / span);
  return out;
}

const DIRS = 6;

export function carveBlock(gray, w, h, seed = 7) {
  const rand = seeded(seed);
  const n = w * h;
  const base = normalise(blur(gray, w, h, 1.1));
  const wide = blur(base, w, h, 44);
  const tone = new Float32Array(n);
  for (let i = 0; i < n; i += 1) tone[i] = clamp01(0.5 + (base[i] - 0.5) * 1.05 + 0.55 * (base[i] - wide[i]));
  const soft = blur(tone, w, h, 1.6);
  const fine = blur(tone, w, h, 1.2);
  const broad = blur(tone, w, h, 4.5);

  const gs = blur(tone, w, h, 5);
  const jxx = new Float32Array(n);
  const jyy = new Float32Array(n);
  const jxy = new Float32Array(n);
  for (let y = 1; y < h - 1; y += 1) {
    for (let x = 1; x < w - 1; x += 1) {
      const i = y * w + x;
      const gx = gs[i + 1] - gs[i - 1];
      const gy = gs[i + w] - gs[i - w];
      jxx[i] = gx * gx;
      jyy[i] = gy * gy;
      jxy[i] = gx * gy;
    }
  }
  const sxx = blur(jxx, w, h, 34);
  const syy = blur(jyy, w, h, 34);
  const sxy = blur(jxy, w, h, 34);
  const dirIndex = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) {
    const strength = sxx[i] + syy[i];
    let theta = 0.5 * Math.atan2(2 * sxy[i], sxx[i] - syy[i]) + Math.PI / 2;
    if (strength < 2e-5) theta = Math.PI * 0.25;
    let k = Math.round((theta / Math.PI) * DIRS) % DIRS;
    if (k < 0) k += DIRS;
    dirIndex[i] = k;
  }
  const dirs = [];
  for (let k = 0; k < DIRS; k += 1) {
    const a = (k / DIRS) * Math.PI;
    dirs.push([Math.cos(a), Math.sin(a)]);
  }

  const raisedHard = new Float32Array(n);
  const floor = new Float32Array(n);
  const period = 9.5;
  const gougePeriod = 13;
  const rows = new Map();
  const rowInfo = (k, row) => {
    const key = k * 100000 + row;
    let info = rows.get(key);
    if (!info) {
      info = { offset: rand() * 400, len: 60 + rand() * 140, wobble: rand() * 6.28 };
      rows.set(key, info);
    }
    return info;
  };

  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const t = soft[i];
      const k = dirIndex[i];
      const d = dirs[k];
      const wob = (valueNoise(x / 38, y / 38, seed + k) - 0.5) * 3.2;
      const across = -x * d[1] + y * d[0] + wob;
      const tri = Math.abs(((across / period) % 1 + 1) % 1 - 0.5) * 2;
      const dark = 1 - t;
      let ink;
      if (dark > 0.8) ink = 1;
      else if (dark < 0.2) ink = 0;
      else {
        const width = 0.2 + 0.62 * smooth(0.2, 0.8, dark);
        ink = tri < width ? 1 : 0;
      }
      const dog = fine[i] - broad[i];
      if (dog < -0.05 && dark > 0.14) ink = 1;
      else if (dog > 0.07 && dark < 0.9) ink = 0;
      raisedHard[i] = ink;

      const gk = (k + 2) % DIRS;
      const gd = dirs[gk];
      const ga = -x * gd[1] + y * gd[0] + (valueNoise(x / 60, y / 60, seed + 31) - 0.5) * 6;
      const gl = x * gd[0] + y * gd[1];
      const row = Math.floor(ga / gougePeriod);
      const info = rowInfo(gk, row);
      const v = (ga / gougePeriod - row) * 2 - 1;
      const segPos = (gl + info.offset) / info.len;
      const seg = segPos - Math.floor(segPos);
      const taper = smooth(0, 0.12, seg) * smooth(1, 0.88, seg);
      floor[i] = 1 - (1 - v * v) * (0.55 + 0.45 * taper);
    }
  }

  const density = boxBlur(raisedHard, w, h, 2);
  const raised = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const d = density[i];
    raised[i] = raisedHard[i] > 0.5 ? (d < 0.2 ? 0 : 1) : d > 0.86 ? 1 : 0;
  }

  const reach = blur(raised, w, h, 10);
  const far = blur(raised, w, h, 36);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (raised[i] > 0.5) continue;
      const near = reach[i];
      if (near > 0.04 && near < 0.3 && floor[i] < 0.08) {
        const row = Math.floor(x / 23) * 7 + Math.floor(y / 29);
        if (hash2(row, 3, seed) < 0.1 && floor[i] < 0.03) raised[i] = 1;
      }
    }
  }

  const rimInset = 9;
  const rimWidth = 7;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const edge = Math.min(x, y, w - 1 - x, h - 1 - y);
      const jag = (valueNoise(x / 9 + y / 13, y / 9 - x / 17, seed + 5) - 0.5) * 2.4;
      if (edge < rimInset - 3 + jag) raised[i] = 0;
      else if (edge < rimInset + rimWidth + jag) raised[i] = 1;
      else if (edge < rimInset + rimWidth + 5 + jag * 1.5) raised[i] = 0;
    }
  }

  const bevel = blur(raised, w, h, 1.2);
  const out = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i += 1) {
    out[i * 4] = Math.round(clamp01(bevel[i]) * 255);
    out[i * 4 + 1] = Math.round(clamp01(floor[i]) * 255);
    out[i * 4 + 2] = Math.round(clamp01(1 - far[i] * 1.6) * 255);
    out[i * 4 + 3] = 255;
  }
  return out;
}
