function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function boxBlur(source, width, height, radius) {
  if (radius < 1) return source;
  const temp = new Float32Array(source.length);
  const out = new Float32Array(source.length);
  const span = radius * 2 + 1;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    let sum = 0;
    for (let k = -radius; k <= radius; k += 1) sum += source[row + Math.min(width - 1, Math.max(0, k))];
    for (let x = 0; x < width; x += 1) {
      temp[row + x] = sum / span;
      sum += source[row + Math.min(width - 1, x + radius + 1)] - source[row + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let k = -radius; k <= radius; k += 1) sum += temp[Math.min(height - 1, Math.max(0, k)) * width + x];
    for (let y = 0; y < height; y += 1) {
      out[y * width + x] = sum / span;
      sum += temp[Math.min(height - 1, y + radius + 1) * width + x] - temp[Math.max(0, y - radius) * width + x];
    }
  }
  return out;
}

export function blur(source, width, height, radius) {
  let field = source;
  for (let i = 0; i < 3; i += 1) field = boxBlur(field, width, height, radius);
  return field;
}

function percentile(values, fraction) {
  const sample = [];
  const step = Math.max(1, Math.floor(values.length / 40000));
  for (let i = 0; i < values.length; i += step) sample.push(values[i]);
  sample.sort((a, b) => a - b);
  return sample[Math.min(sample.length - 1, Math.max(0, Math.floor(fraction * sample.length)))];
}

export function densityFromPixels(pixels, width, height, { paper = 0.5, gamma = 1.1, edge = 0.9, detail = 0.6, cut = 0.05 } = {}) {
  const count = width * height;
  const dark = new Float32Array(count);
  const warm = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const r = pixels[i * 4] / 255;
    const g = pixels[i * 4 + 1] / 255;
    const b = pixels[i * 4 + 2] / 255;
    dark[i] = 1 - (0.2126 * r + 0.7152 * g + 0.0722 * b);
    const lift = r - Math.max(g * 0.92, b);
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    warm[i] = Math.max(0, Math.min(1, (lift - 0.1) * 2.8)) * Math.min(1, chroma * 2.4);
  }
  const unit = Math.max(width, height) / 600;
  const broad = blur(dark, width, height, Math.max(3, Math.round(10 * unit)));
  const sharp = blur(dark, width, height, Math.max(1, Math.round(0.8 * unit)));
  const enhanced = new Float32Array(count);
  for (let i = 0; i < count; i += 1) enhanced[i] = sharp[i] + (sharp[i] - broad[i]) * detail;
  const floor = percentile(enhanced, paper);
  const ceiling = percentile(enhanced, 0.995);
  const span = Math.max(0.05, ceiling - floor);
  const soft = blur(dark, width, height, Math.max(1, Math.round(1.5 * unit)));
  const gradient = new Float32Array(count);
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const gx = soft[i + 1] - soft[i - 1];
      const gy = soft[i + width] - soft[i - width];
      gradient[i] = Math.hypot(gx, gy);
    }
  }
  const gradientHigh = percentile(gradient, 0.985);
  const density = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const tone = Math.max(0, Math.min(1, (enhanced[i] - floor) / span));
    const line = Math.max(0, Math.min(1, gradient[i] / Math.max(0.0001, gradientHigh)));
    const value = Math.pow(tone, gamma) + edge * line * line * (0.35 + tone * 0.65);
    density[i] = value < cut ? 0 : Math.min(1, value);
  }
  const warmth = blur(warm, width, height, Math.max(1, Math.round(2 * unit)));
  return { density, warmth, width, height };
}

export function createStipple({ density, width, height }, count, seed = 7) {
  const random = mulberry(seed);
  const total = density.reduce((sum, v) => sum + v, 0);
  const cumulative = new Float32Array(density.length);
  let run = 0;
  for (let i = 0; i < density.length; i += 1) {
    run += density[i];
    cumulative[i] = run;
  }
  const points = new Float32Array(count * 2);
  const pick = () => {
    const target = random() * total;
    let lo = 0;
    let hi = density.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return [(lo % width) + random(), Math.floor(lo / width) + random()];
  };
  for (let i = 0; i < count; i += 1) {
    const [x, y] = pick();
    points[i * 2] = x;
    points[i * 2 + 1] = y;
  }
  const cell = Math.max(2, Math.sqrt((total / count) * 1.0));
  const gridW = Math.ceil(width / cell) + 1;
  const gridH = Math.ceil(height / cell) + 1;
  const heads = new Int32Array(gridW * gridH);
  const next = new Int32Array(count);
  const sumX = new Float64Array(count);
  const sumY = new Float64Array(count);
  const mass = new Float64Array(count);
  const state = { points, count, width, height, cell, gridW, gridH, heads, next, sumX, sumY, mass, density, pick, iteration: 0 };
  return state;
}

function nearest(state, px, py) {
  const { points, cell, gridW, gridH, heads, next } = state;
  const cx = Math.floor(px / cell);
  const cy = Math.floor(py / cell);
  let best = -1;
  let bestD = Infinity;
  for (let ring = 1; ring <= 6; ring += 1) {
    for (let gy = Math.max(0, cy - ring); gy <= Math.min(gridH - 1, cy + ring); gy += 1) {
      for (let gx = Math.max(0, cx - ring); gx <= Math.min(gridW - 1, cx + ring); gx += 1) {
        if (ring > 1 && gx > cx - ring && gx < cx + ring && gy > cy - ring && gy < cy + ring) continue;
        let k = heads[gy * gridW + gx] - 1;
        while (k >= 0) {
          const dx = points[k * 2] - px;
          const dy = points[k * 2 + 1] - py;
          const d = dx * dx + dy * dy;
          if (d < bestD) {
            bestD = d;
            best = k;
          }
          k = next[k] - 1;
        }
      }
    }
    if (best >= 0 && Math.sqrt(bestD) <= (ring - 0.5) * cell) break;
  }
  return best;
}

export function relax(state, iterations = 1) {
  const { points, count, width, height, cell, gridW, heads, next, sumX, sumY, mass, density } = state;
  for (let it = 0; it < iterations; it += 1) {
    heads.fill(0);
    for (let i = 0; i < count; i += 1) {
      const g = Math.floor(points[i * 2 + 1] / cell) * gridW + Math.floor(points[i * 2] / cell);
      next[i] = heads[g];
      heads[g] = i + 1;
    }
    sumX.fill(0);
    sumY.fill(0);
    mass.fill(0);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const w = density[y * width + x];
        if (w <= 0.002) continue;
        const px = x + 0.5;
        const py = y + 0.5;
        const k = nearest(state, px, py);
        if (k < 0) continue;
        sumX[k] += px * w;
        sumY[k] += py * w;
        mass[k] += w;
      }
    }
    for (let i = 0; i < count; i += 1) {
      if (mass[i] > 0) {
        points[i * 2] = Math.min(width - 0.01, Math.max(0, sumX[i] / mass[i]));
        points[i * 2 + 1] = Math.min(height - 0.01, Math.max(0, sumY[i] / mass[i]));
      } else {
        const [x, y] = state.pick();
        points[i * 2] = x;
        points[i * 2 + 1] = y;
      }
    }
    state.iteration += 1;
  }
  return state;
}

export function packStipple(state, warmth) {
  const { points, count, width, height } = state;
  const out = new Float32Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    const x = points[i * 2];
    const y = points[i * 2 + 1];
    const j = Math.min(height - 1, Math.floor(y)) * width + Math.min(width - 1, Math.floor(x));
    out[i * 4] = x / width;
    out[i * 4 + 1] = y / height;
    out[i * 4 + 2] = warmth ? warmth[j] : 0;
    out[i * 4 + 3] = state.density[j];
  }
  return out;
}

export const STIPPLE_TONE = { gamma: 2.3, edge: 0.9, paper: 0.32, detail: 1.0, cut: 0.06 };
export const STIPPLE_COVER = 0.85;

export function decodePoints(pixels, count) {
  const points = new Float32Array(count * 2);
  let n = 0;
  for (let i = 0; i < count; i += 1) {
    const o = i * 4;
    const a = pixels[o];
    const b = pixels[o + 1];
    const c = pixels[o + 2];
    if (a === 255 && b === 255 && c === 255) continue;
    const x = (a << 4) | (b >> 4);
    const y = (c << 4) | (b & 15);
    points[n * 2] = x / 4095;
    points[n * 2 + 1] = y / 4095;
    n += 1;
  }
  return points.subarray(0, n * 2);
}

export function describePoints(points, field) {
  const { density, warmth, width, height } = field;
  const count = points.length / 2;
  const info = new Float32Array(count * 2);
  let total = 0;
  for (let i = 0; i < density.length; i += 1) total += density[i];
  for (let i = 0; i < count; i += 1) {
    const x = Math.min(width - 1, Math.floor(points[i * 2] * width));
    const y = Math.min(height - 1, Math.floor(points[i * 2 + 1] * height));
    const j = y * width + x;
    const dn = density[j];
    const accent = warmth[j] > 0.45 && dn < 0.55 ? 1 : 0;
    info[i * 2] = (0.7 + 0.3 * dn) * (accent ? 1.2 : 1);
    info[i * 2 + 1] = accent;
  }
  const radius = Math.sqrt((STIPPLE_COVER * total) / (count * Math.PI)) / width;
  return { info, radius };
}

export function normalizedPoints(state) {
  const { points, count, width, height } = state;
  const out = new Float32Array(count * 2);
  for (let i = 0; i < count; i += 1) {
    out[i * 2] = points[i * 2] / width;
    out[i * 2 + 1] = points[i * 2 + 1] / height;
  }
  return out;
}
