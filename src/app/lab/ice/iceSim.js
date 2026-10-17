export const BLOCK = { hx: 0.75, h: 0.44, hz: 0.75, r: 0.07 };
export const SLEEVE = { half: 0.5, thick: 0.007, discR: 0.47, discOff: 0.15, y: 0.21, yaw: 0.07 };
export const MELT_N = 160;
export const MELT_EXT = 0.82;
export const FACE_W = 1024;
export const FACE_H = 64;
export const PUDDLE_N = 192;
export const PUDDLE_EXT = 3.0;

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);

function toHalf(v) {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  let exp = ((x >>> 23) & 0xff) - 112;
  const mant = x & 0x7fffff;
  if (exp <= 0) return sign;
  if (exp >= 31) return sign | 0x7bff;
  return sign | (exp << 10) | (mant >>> 13);
}

function hash(x, y, s) {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(x, y, s) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix, iy, s);
  const b = hash(ix + 1, iy, s);
  const c = hash(ix, iy + 1, s);
  const d = hash(ix + 1, iy + 1, s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function inBlock(x, z, inset = 0) {
  const qx = Math.abs(x) - (BLOCK.hx - inset) + BLOCK.r;
  const qz = Math.abs(z) - (BLOCK.hz - inset) + BLOCK.r;
  const out = Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0) - BLOCK.r;
  return out < 0;
}

export function faceAt(x, z) {
  const ax = Math.abs(x) / BLOCK.hx;
  const az = Math.abs(z) / BLOCK.hz;
  if (ax > az) {
    const face = x > 0 ? 1 : 3;
    const u = (x > 0 ? -z : z) / (2 * BLOCK.hz) + 0.5;
    return { face, u, dist: BLOCK.hx - Math.abs(x) };
  }
  const face = z > 0 ? 0 : 2;
  const u = (z > 0 ? x : -x) / (2 * BLOCK.hx) + 0.5;
  return { face, u, dist: BLOCK.hz - Math.abs(z) };
}

export function faceBase(face, u, out = 0.03) {
  const t = u - 0.5;
  if (face === 0) return [t * 2 * BLOCK.hx, BLOCK.hz + out];
  if (face === 2) return [-t * 2 * BLOCK.hx, -BLOCK.hz - out];
  if (face === 1) return [BLOCK.hx + out, -t * 2 * BLOCK.hz];
  return [-BLOCK.hx - out, t * 2 * BLOCK.hz];
}

export function createIceSim() {
  const N = MELT_N;
  const cell = (2 * MELT_EXT) / N;
  const depth = new Float32Array(N * N);
  const wet = new Float32Array(N * N);
  const cap = new Float32Array(N * N);
  const onSleeve = new Uint8Array(N * N);
  const scratch = new Float32Array(N * N);
  const meltHalf = new Uint16Array(N * N * 2);
  const face = new Float32Array(FACE_W * FACE_H);
  const faceHalf = new Uint16Array(FACE_W * FACE_H);
  const P = PUDDLE_N;
  const pcell = (2 * PUDDLE_EXT) / P;
  const water = new Float32Array(P * P);
  const waterNext = new Float32Array(P * P);
  const pin = new Float32Array(P * P);
  const puddleHalf = new Uint16Array(P * P);
  const drops = [];
  let pool = 0;
  let seed = 1;
  let meltDirty = true;
  let faceDirty = true;
  let puddleDirty = true;
  let puddleActive = false;
  let sleeveCap = BLOCK.h;
  let sleeveFoot = null;

  function cellX(i) {
    return -MELT_EXT + (i + 0.5) * cell;
  }

  function configure(newSeed, foot) {
    seed = newSeed;
    sleeveFoot = foot;
    sleeveCap = BLOCK.h - (SLEEVE.y + SLEEVE.thick) + 0.004;
    for (let j = 0; j < N; j += 1) {
      for (let i = 0; i < N; i += 1) {
        const x = cellX(i);
        const z = cellX(j);
        const over = foot(x, z, 0.012);
        onSleeve[j * N + i] = over ? 1 : 0;
        cap[j * N + i] = over ? sleeveCap : BLOCK.h * 0.9;
      }
    }
    for (let j = 0; j < P; j += 1) {
      for (let i = 0; i < P; i += 1) {
        const x = -PUDDLE_EXT + (i + 0.5) * pcell;
        const z = -PUDDLE_EXT + (j + 0.5) * pcell;
        const n = valueNoise(x * 2.2, z * 2.2, seed) * 0.6 + valueNoise(x * 6, z * 6, seed + 7) * 0.4;
        pin[j * P + i] = 0.07 + 0.11 * n;
      }
    }
  }

  function clear() {
    depth.fill(0);
    wet.fill(0);
    face.fill(0);
    water.fill(0);
    drops.length = 0;
    pool = 0;
    meltDirty = faceDirty = puddleDirty = true;
    puddleActive = false;
  }

  function depthAt(x, z) {
    const fi = (x + MELT_EXT) / cell - 0.5;
    const fj = (z + MELT_EXT) / cell - 0.5;
    const i = Math.max(0, Math.min(N - 2, Math.floor(fi)));
    const j = Math.max(0, Math.min(N - 2, Math.floor(fj)));
    const tx = Math.max(0, Math.min(1, fi - i));
    const tz = Math.max(0, Math.min(1, fj - j));
    const a = depth[j * N + i];
    const b = depth[j * N + i + 1];
    const c = depth[(j + 1) * N + i];
    const d = depth[(j + 1) * N + i + 1];
    return a + (b - a) * tx + (c - a) * tz + (a - b - c + d) * tx * tz;
  }

  function brush(x, z, radius, amount) {
    if (amount <= 0) return 0;
    const r2 = radius * radius;
    const i0 = Math.max(0, Math.floor((x - radius * 1.5 + MELT_EXT) / cell));
    const i1 = Math.min(N - 1, Math.ceil((x + radius * 1.5 + MELT_EXT) / cell));
    const j0 = Math.max(0, Math.floor((z - radius * 1.5 + MELT_EXT) / cell));
    const j1 = Math.min(N - 1, Math.ceil((z + radius * 1.5 + MELT_EXT) / cell));
    let removed = 0;
    let touched = false;
    for (let j = j0; j <= j1; j += 1) {
      const cz = cellX(j) - z;
      for (let i = i0; i <= i1; i += 1) {
        const cx = cellX(i) - x;
        const d2 = cx * cx + cz * cz;
        const k = j * N + i;
        if (d2 < r2 * 2.25) {
          const wetK = Math.min(1, (1 - d2 / (r2 * 2.25)) * 1.6);
          if (wetK > wet[k] + 0.001) {
            wet[k] = wetK;
            touched = true;
          }
        }
        if (d2 >= r2) continue;
        const s = 1 - d2 / r2;
        const add = amount * s * (0.6 + 0.4 * s);
        const before = depth[k];
        const lim = cap[k];
        if (before >= lim) continue;
        const next = Math.min(lim, before + add * (1 - 0.35 * (before / BLOCK.h)));
        depth[k] = next;
        removed += next - before;
      }
    }
    if (touched || removed > 0) meltDirty = true;
    return removed * cell * cell;
  }

  function relax(x, z, radius, rate) {
    const reach = radius * 2.2;
    const i0 = Math.max(1, Math.floor((x - reach + MELT_EXT) / cell));
    const i1 = Math.min(N - 2, Math.ceil((x + reach + MELT_EXT) / cell));
    const j0 = Math.max(1, Math.floor((z - reach + MELT_EXT) / cell));
    const j1 = Math.min(N - 2, Math.ceil((z + reach + MELT_EXT) / cell));
    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        const k = j * N + i;
        const avg = (depth[k - 1] + depth[k + 1] + depth[k - N] + depth[k + N]) * 0.25;
        scratch[k] = depth[k] + (avg - depth[k]) * rate;
      }
    }
    for (let j = j0; j <= j1; j += 1) {
      for (let i = i0; i <= i1; i += 1) {
        const k = j * N + i;
        const next = Math.min(cap[k], Math.max(depth[k], scratch[k] * 0.98 + depth[k] * 0.02));
        if (next - depth[k] > 1e-6) meltDirty = true;
        depth[k] = next;
      }
    }
  }

  function exposure() {
    if (!sleeveFoot) return 0;
    let count = 0;
    for (let k = 0; k < N * N; k += 1) if (onSleeve[k] && depth[k] >= cap[k] - 0.006) count += 1;
    return count * cell * cell;
  }

  function addWater(x, z, volume) {
    pool += volume;
    if (pool < 0.0009 || drops.length > 28) return;
    const near = faceAt(x, z);
    if (near.dist > 0.6) return;
    pool -= 0.0009;
    const u = Math.max(0.02, Math.min(0.98, near.u + (hash(drops.length, Math.floor(pool * 1e6), seed) - 0.5) * 0.12));
    const [bx, bz] = faceBase(near.face, u, -0.004);
    const top = BLOCK.h - depthAt(bx * 0.97, bz * 0.97);
    drops.push({
      face: near.face,
      u,
      y: Math.max(0.05, top - 0.01),
      v: 0.02,
      vmax: 0.22 + hash(drops.length, 3, seed) * 0.16,
      phase: hash(drops.length, 5, seed) * 6.28,
      drift: (hash(drops.length, 9, seed) - 0.5) * 0.02,
      size: 1.2 + hash(drops.length, 11, seed) * 0.9,
    });
  }

  function paintFace(faceIdx, u, y, radius, value) {
    const px = (faceIdx + Math.max(0.002, Math.min(0.998, u))) / 4 * FACE_W - 0.5;
    const py = (y / BLOCK.h) * FACE_H - 0.5;
    const r = Math.ceil(radius * 2 + 1);
    for (let j = Math.max(0, Math.floor(py) - 1); j <= Math.min(FACE_H - 1, Math.ceil(py) + 1); j += 1) {
      for (let i = Math.max(0, Math.floor(px) - r); i <= Math.min(FACE_W - 1, Math.ceil(px) + r); i += 1) {
        const dx = (i - px) / radius;
        const dy = (j - py) / 1.2;
        const w = Math.exp(-(dx * dx + dy * dy));
        const k = j * FACE_W + i;
        face[k] = Math.max(face[k], value * w);
      }
    }
    faceDirty = true;
  }

  function deposit(x, z, volume, radius = 0.05) {
    const r = Math.max(1, Math.ceil(radius / pcell));
    const ci = Math.floor((x + PUDDLE_EXT) / pcell);
    const cj = Math.floor((z + PUDDLE_EXT) / pcell);
    let total = 0;
    const weights = [];
    for (let j = cj - r; j <= cj + r; j += 1) {
      for (let i = ci - r; i <= ci + r; i += 1) {
        if (i < 1 || j < 1 || i >= P - 1 || j >= P - 1) continue;
        const d2 = ((i - ci) ** 2 + (j - cj) ** 2) / (r * r);
        if (d2 > 1) continue;
        const w = 1 - d2;
        weights.push(j * P + i, w);
        total += w;
      }
    }
    if (total <= 0) return;
    const per = volume / (pcell * pcell);
    for (let n = 0; n < weights.length; n += 2) water[weights[n]] += (per * weights[n + 1]) / total;
    puddleActive = true;
    puddleDirty = true;
  }

  function stepDrops(dt) {
    for (let n = drops.length - 1; n >= 0; n -= 1) {
      const d = drops[n];
      const prevY = d.y;
      const prevU = d.u;
      d.v = Math.min(d.vmax, d.v + dt * 0.9);
      d.y -= d.v * dt;
      d.u += (Math.sin(d.y * 26 + d.phase) * 0.012 + d.drift) * d.v * dt * 4;
      const steps = Math.max(1, Math.ceil(((prevY - d.y) / BLOCK.h) * FACE_H * 1.5));
      for (let s = 1; s <= steps; s += 1) {
        const t = s / steps;
        paintFace(d.face, prevU + (d.u - prevU) * t, prevY + (d.y - prevY) * t, d.size, 0.75);
      }
      if (d.y <= 0.004) {
        const [x, z] = faceBase(d.face, d.u, 0.035);
        deposit(x, z, 0.0016, 0.06);
        drops.splice(n, 1);
      }
    }
  }

  function stepPuddle() {
    if (!puddleActive) return;
    let moved = 0;
    for (let iter = 0; iter < 3; iter += 1) {
      waterNext.set(water);
      for (let j = 1; j < P - 1; j += 1) {
        for (let i = 1; i < P - 1; i += 1) {
          const k = j * P + i;
          const h = water[k];
          if (h <= pin[k]) continue;
          const spare = (h - pin[k]) * 0.2;
          const nb = [k - 1, k + 1, k - P, k + P];
          let lower = 0;
          for (const m of nb) if (water[m] < h) lower += h - water[m];
          if (lower <= 0) continue;
          for (const m of nb) {
            if (water[m] >= h) continue;
            const f = Math.min(spare, lower * 0.25) * ((h - water[m]) / lower);
            waterNext[k] -= f;
            waterNext[m] += f;
            moved += f;
          }
        }
      }
      water.set(waterNext);
    }
    puddleDirty = true;
    if (moved < 0.002) puddleActive = false;
  }

  function scaleAll(k) {
    for (let i = 0; i < depth.length; i += 1) {
      depth[i] *= k;
      wet[i] *= k;
    }
    for (let i = 0; i < face.length; i += 1) face[i] *= k;
    for (let i = 0; i < water.length; i += 1) water[i] *= k;
    drops.length = 0;
    meltDirty = faceDirty = puddleDirty = true;
  }

  function packMelt() {
    for (let k = 0; k < N * N; k += 1) {
      meltHalf[k * 2] = toHalf(depth[k]);
      meltHalf[k * 2 + 1] = toHalf(wet[k]);
    }
    meltDirty = false;
    return meltHalf;
  }

  function packFace() {
    for (let k = 0; k < face.length; k += 1) faceHalf[k] = toHalf(face[k]);
    faceDirty = false;
    return faceHalf;
  }

  function packPuddle() {
    for (let k = 0; k < water.length; k += 1) puddleHalf[k] = toHalf(water[k]);
    puddleDirty = false;
    return puddleHalf;
  }

  return {
    configure,
    clear,
    depthAt,
    brush,
    relax,
    exposure,
    addWater,
    deposit,
    paintFace,
    stepDrops,
    stepPuddle,
    scaleAll,
    inBlock,
    get busy() {
      return drops.length > 0 || puddleActive;
    },
    get dirty() {
      return { melt: meltDirty, face: faceDirty, puddle: puddleDirty };
    },
    packMelt,
    packFace,
    packPuddle,
  };
}
