const FIRST = 32;
const LAST = 126;
export const ATLAS_COLS = 16;
const CANDIDATES = " .`'-,:;_~^\"!=+<>ilrcvx*zsjo?7tnuaeyk1fh2Z3#S5wO8%&0@$WMBNQ";

export const glyphIndex = (ch) => {
  const code = ch.charCodeAt(0);
  if (code < FIRST || code > LAST) return 0;
  return code - FIRST;
};

export function buildAtlas(cw, ch, dpr) {
  const count = LAST - FIRST + 1;
  const rows = Math.ceil(count / ATLAS_COLS);
  const w = ATLAS_COLS * cw;
  const h = rows * ch;
  const sharp = document.createElement("canvas");
  sharp.width = w;
  sharp.height = h;
  const sx = sharp.getContext("2d", { willReadFrequently: true });
  const size = ch * 0.74;
  sx.font = `500 ${size}px FieldMono, ui-monospace, monospace`;
  sx.textAlign = "center";
  sx.textBaseline = "middle";
  sx.fillStyle = "#fff";
  for (let i = 0; i < count; i += 1) {
    const gx = (i % ATLAS_COLS) * cw;
    const gy = Math.floor(i / ATLAS_COLS) * ch;
    sx.save();
    sx.beginPath();
    sx.rect(gx, gy, cw, ch);
    sx.clip();
    sx.fillText(String.fromCharCode(FIRST + i), gx + cw / 2, gy + ch * 0.53);
    sx.restore();
  }
  const soft = document.createElement("canvas");
  soft.width = w;
  soft.height = h;
  const bx = soft.getContext("2d", { willReadFrequently: true });
  for (let i = 0; i < count; i += 1) {
    const gx = (i % ATLAS_COLS) * cw;
    const gy = Math.floor(i / ATLAS_COLS) * ch;
    bx.save();
    bx.beginPath();
    bx.rect(gx, gy, cw, ch);
    bx.clip();
    bx.filter = `blur(${(1.6 * dpr).toFixed(2)}px)`;
    bx.drawImage(sharp, gx, gy, cw, ch, gx, gy, cw, ch);
    bx.drawImage(sharp, gx, gy, cw, ch, gx, gy, cw, ch);
    bx.restore();
  }
  const a = sx.getImageData(0, 0, w, h).data;
  const b = bx.getImageData(0, 0, w, h).data;
  const out = new ImageData(w, h);
  const o = out.data;
  for (let i = 0; i < a.length; i += 4) {
    o[i] = a[i + 3];
    o[i + 1] = Math.min(255, b[i + 3] * 1.4);
    o[i + 2] = 0;
    o[i + 3] = 255;
  }
  const coverage = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const gx = (i % ATLAS_COLS) * cw;
    const gy = Math.floor(i / ATLAS_COLS) * ch;
    let sum = 0;
    for (let y = 0; y < ch; y += 1) for (let x = 0; x < cw; x += 1) sum += a[((gy + y) * w + gx + x) * 4 + 3];
    coverage[i] = sum / (cw * ch * 255);
  }
  const pool = [...new Set(CANDIDATES)].map((c) => ({ c, v: coverage[glyphIndex(c)] })).sort((p, q) => p.v - q.v);
  const max = pool[pool.length - 1].v;
  const levels = 22;
  const ramp = [glyphIndex(" ")];
  const used = new Set([" "]);
  for (let k = 1; k < levels; k += 1) {
    const want = max * Math.pow(k / (levels - 1), 1.15);
    let best = null;
    for (const p of pool) {
      if (used.has(p.c) || p.v <= 0) continue;
      if (!best || Math.abs(p.v - want) < Math.abs(best.v - want)) best = p;
    }
    if (!best) break;
    used.add(best.c);
    ramp.push(glyphIndex(best.c));
  }
  const ordered = ramp.slice(1).map((g) => ({ g, v: coverage[g] })).sort((p, q) => p.v - q.v).map((p) => p.g);
  return { image: out, ramp: Uint8Array.from([ramp[0], ...ordered]) };
}

const GRAD = [
  [1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1],
];
const PERM = new Uint8Array(512);
{
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i += 1) p[i] = i;
  let s = 7331;
  for (let i = 255; i > 0; i -= 1) {
    s = (s * 1103515245 + 12345) >>> 0;
    const j = s % (i + 1);
    const t = p[i];
    p[i] = p[j];
    p[j] = t;
  }
  for (let i = 0; i < 512; i += 1) PERM[i] = p[i & 255];
}
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

export function simplex(xin, yin) {
  const s = (xin + yin) * F2;
  const i = Math.floor(xin + s);
  const j = Math.floor(yin + s);
  const t = (i + j) * G2;
  const x0 = xin - (i - t);
  const y0 = yin - (j - t);
  const i1 = x0 > y0 ? 1 : 0;
  const j1 = x0 > y0 ? 0 : 1;
  const x1 = x0 - i1 + G2;
  const y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2;
  const y2 = y0 - 1 + 2 * G2;
  const ii = i & 255;
  const jj = j & 255;
  let n = 0;
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 > 0) {
    const g = GRAD[PERM[ii + PERM[jj]] & 7];
    t0 *= t0;
    n += t0 * t0 * (g[0] * x0 + g[1] * y0);
  }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 > 0) {
    const g = GRAD[PERM[ii + i1 + PERM[jj + j1]] & 7];
    t1 *= t1;
    n += t1 * t1 * (g[0] * x1 + g[1] * y1);
  }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 > 0) {
    const g = GRAD[PERM[ii + 1 + PERM[jj + 1]] & 7];
    t2 *= t2;
    n += t2 * t2 * (g[0] * x2 + g[1] * y2);
  }
  return 70 * n;
}

function blurCells(src, cols, rows, radius) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const span = radius * 2 + 1;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      let s = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const xx = Math.min(cols - 1, Math.max(0, x + k));
        s += src[y * cols + xx];
      }
      tmp[y * cols + x] = s / span;
    }
  }
  const vr = Math.max(1, Math.round(radius * 0.6));
  const vspan = vr * 2 + 1;
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      let s = 0;
      for (let k = -vr; k <= vr; k += 1) {
        const yy = Math.min(rows - 1, Math.max(0, y + k));
        s += tmp[yy * cols + x];
      }
      out[y * cols + x] = s / vspan;
    }
  }
  return out;
}

const SS = 4;

function sampleCanvas(cols, rows, cw, ch, draw) {
  const c = document.createElement("canvas");
  c.width = cols * SS;
  c.height = rows * SS;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.setTransform(SS / cw, 0, 0, SS / ch, 0, 0);
  draw(x);
  return x.getImageData(0, 0, c.width, c.height).data;
}

function layouts(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const out = [[words.join(" ")]];
  for (let a = 1; a < words.length; a += 1) {
    out.push([words.slice(0, a).join(" "), words.slice(a).join(" ")]);
    for (let b = a + 1; b < words.length; b += 1) out.push([words.slice(0, a).join(" "), words.slice(a, b).join(" "), words.slice(b).join(" ")]);
  }
  return out;
}

export function wordTarget(text, { cols, rows, cw, ch, region }) {
  const n = cols * rows;
  const cov = new Float32Array(n);
  let lineCount = 1;
  const data = sampleCanvas(cols, rows, cw, ch, (x) => {
    const maxW = region.w * 0.9;
    const maxH = region.h * 0.74;
    x.font = `700 100px FieldSans, Arial, sans-serif`;
    let lines = [text];
    let size = 0;
    for (const option of layouts(text)) {
      const widest = Math.max(...option.map((l) => x.measureText(l).width));
      const s0 = Math.min((100 * maxW) / widest, maxH / (option.length * 0.98), 260) * (option.length > 1 ? 0.97 : 1);
      if (s0 > size * 1.04) {
        size = s0;
        lines = option;
      }
    }
    x.font = `700 ${size}px FieldSans, Arial, sans-serif`;
    lineCount = lines.length;
    x.fillStyle = "#fff";
    x.strokeStyle = "#fff";
    x.lineJoin = "round";
    x.lineWidth = size * 0.045;
    x.textAlign = "center";
    x.textBaseline = "middle";
    const lh = size * 0.98;
    const cy = region.y + region.h / 2 - ((lines.length - 1) * lh) / 2;
    lines.forEach((l, i) => {
      x.fillText(l, region.x + region.w / 2, cy + i * lh + size * 0.04);
      x.strokeText(l, region.x + region.w / 2, cy + i * lh + size * 0.04);
    });
  });
  const W = cols * SS;
  let top = rows;
  let bottom = 0;
  for (let y = 0; y < rows; y += 1) {
    for (let xx = 0; xx < cols; xx += 1) {
      let s = 0;
      for (let j = 0; j < SS; j += 1) for (let i = 0; i < SS; i += 1) s += data[((y * SS + j) * W + xx * SS + i) * 4 + 3];
      const v = s / (SS * SS * 255);
      cov[y * cols + xx] = v;
      if (v > 0.05) {
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
  }
  const halo = blurCells(cov, cols, rows, 2);
  const target = new Float32Array(n);
  const span = Math.max(1, bottom - top);
  for (let y = 0; y < rows; y += 1) {
    const shade = 0.9 + 0.1 * (1 - (y - top) / span) * (lineCount > 1 ? 0.6 : 1);
    for (let xx = 0; xx < cols; xx += 1) {
      const i = y * cols + xx;
      target[i] = Math.min(1, Math.max(Math.pow(cov[i], 0.6) * shade, halo[i] * 0.3));
    }
  }
  const spread = blurCells(cov.map((v) => (v > 0.02 ? 1 : 0)), cols, rows, 5);
  const mask = spread.map((v) => Math.min(1, v * 3));
  return { target, mask };
}

export function coverTarget(img, { cols, rows, cw, ch, region }, crop = [0, 0, 1, 1], gamma = 0.85) {
  const n = cols * rows;
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const sw = crop[2] * iw;
  const sh = crop[3] * ih;
  const scale = Math.min(region.w / sw, region.h / sh) * 0.98;
  const dw = sw * scale;
  const dh = sh * scale;
  const x0 = region.x + (region.w - dw) / 2;
  const y0 = region.y + (region.h - dh) / 2;
  const data = sampleCanvas(cols, rows, cw, ch, (x) => {
    x.imageSmoothingEnabled = true;
    x.imageSmoothingQuality = "high";
    x.drawImage(img, crop[0] * iw, crop[1] * ih, sw, sh, x0, y0, dw, dh);
  });
  const W = cols * SS;
  const lum = new Float32Array(n);
  const inside = new Float32Array(n);
  const values = [];
  for (let y = 0; y < rows; y += 1) {
    for (let xx = 0; xx < cols; xx += 1) {
      let s = 0;
      let a = 0;
      for (let j = 0; j < SS; j += 1) {
        for (let i = 0; i < SS; i += 1) {
          const k = ((y * SS + j) * W + xx * SS + i) * 4;
          s += (0.2126 * data[k] + 0.7152 * data[k + 1] + 0.0722 * data[k + 2]) * (data[k + 3] / 255);
          a += data[k + 3];
        }
      }
      const cover = a / (SS * SS * 255);
      const idx = y * cols + xx;
      inside[idx] = cover;
      lum[idx] = cover > 0 ? s / (SS * SS * 255 * Math.max(cover, 0.001)) : 0;
      if (cover > 0.9) values.push(lum[idx]);
    }
  }
  values.sort((p, q) => p - q);
  const lo = values[Math.floor(values.length * 0.02)] ?? 0;
  const hi = values[Math.floor(values.length * 0.985)] ?? 1;
  const norm = lum.map((v) => Math.min(1, Math.max(0, (v - lo) / Math.max(0.05, hi - lo))));
  const soft = blurCells(norm, cols, rows, 1);
  const target = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const sharp = norm[i] + 0.7 * (norm[i] - soft[i]);
    target[i] = Math.min(1, Math.max(0, Math.pow(Math.max(0, sharp), gamma))) * Math.min(1, inside[i] * 1.2);
  }
  const mask = blurCells(inside.map((v) => (v > 0.3 ? 1 : 0)), cols, rows, 2);
  return { target, mask };
}
