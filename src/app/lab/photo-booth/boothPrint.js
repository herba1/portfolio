export const STRIP = { stub: 0.055, top: 0.07, side: 0.075, frameH: 1.06, gap: 0.045, bottom: 0.11 };
export const STRIP_LEN = STRIP.stub + STRIP.top + 4 * STRIP.frameH + 3 * STRIP.gap + STRIP.bottom;
export const TEX_W = 512;
export const TEX_H = Math.round(TEX_W * STRIP_LEN);

const GLYPHS = " .,:;'`-_~!|/\\+=*ilrtcjfvxzsoaeunJLTYCZOQ0UXVAKHNMWB&#@";
const GX = 3;
const GY = 4;
const SUB = 3;
const COLS = 32;
const PAPER = [246, 244, 238];
const INK = [22, 19, 18];

let glyphCache = null;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function fontStack() {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
  return value || "ui-monospace, Menlo, monospace";
}

export async function readyMono() {
  const mono = fontStack();
  try {
    await document.fonts.load(`500 28px ${mono}`);
  } catch {}
  return mono;
}

function frameGeometry() {
  const fw = TEX_W * (1 - 2 * STRIP.side);
  const fh = TEX_W * STRIP.frameH;
  const cellW = fw / COLS;
  const rows = Math.max(8, Math.round(fh / (cellW / 0.6)));
  const cellH = fh / rows;
  return { fw, fh, cellW, cellH, rows };
}

function glyphs(mono) {
  const geo = frameGeometry();
  if (glyphCache && glyphCache.mono === mono) return glyphCache;
  const cw = Math.ceil(geo.cellW);
  const ch = Math.ceil(geo.cellH);
  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const size = Math.min(geo.cellW / 0.6, geo.cellH * 0.98) * 0.94;
  const font = `500 ${size.toFixed(2)}px ${mono}`;
  const list = [];
  const max = new Float32Array(GX * GY);
  for (const char of GLYPHS) {
    ctx.clearRect(0, 0, cw, ch);
    ctx.fillStyle = "#fff";
    ctx.font = font;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(char, cw / 2, ch / 2 + size * 0.04);
    const data = ctx.getImageData(0, 0, cw, ch).data;
    const vec = new Float32Array(GX * GY);
    const count = new Float32Array(GX * GY);
    for (let y = 0; y < ch; y += 1) {
      const ry = Math.min(GY - 1, Math.floor((y / ch) * GY));
      for (let x = 0; x < cw; x += 1) {
        const rx = Math.min(GX - 1, Math.floor((x / cw) * GX));
        const k = ry * GX + rx;
        vec[k] += data[(y * cw + x) * 4 + 3] / 255;
        count[k] += 1;
      }
    }
    let mean = 0;
    for (let k = 0; k < vec.length; k += 1) {
      vec[k] /= Math.max(1, count[k]);
      mean += vec[k];
      max[k] = Math.max(max[k], vec[k]);
    }
    list.push({ char, vec, mean: mean / vec.length });
  }
  let maxMean = 0;
  for (const g of list) {
    for (let k = 0; k < g.vec.length; k += 1) g.vec[k] /= Math.max(1e-4, max[k]);
    g.norm = g.vec.reduce((a, b) => a + b, 0) / g.vec.length;
    maxMean = Math.max(maxMean, g.norm);
  }
  for (const g of list) g.norm /= Math.max(1e-4, maxMean);
  glyphCache = { mono, list, font, size, geo, memo: new Map() };
  return glyphCache;
}

function nearest(cache, vec) {
  let key = "";
  for (let k = 0; k < vec.length; k += 1) key += String.fromCharCode(48 + Math.round(Math.min(1, Math.max(0, vec[k])) * 9));
  const hit = cache.memo.get(key);
  if (hit) return hit;
  let best = cache.list[0];
  let bestD = Infinity;
  for (const g of cache.list) {
    let d = 0;
    for (let k = 0; k < vec.length; k += 1) {
      const e = g.vec[k] - vec[k];
      d += e * e;
    }
    if (d < bestD) {
      bestD = d;
      best = g;
    }
  }
  cache.memo.set(key, best);
  return best;
}

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

function sampleFrame(source, pose, cols, rows) {
  const sw = cols * GX * SUB;
  const sh = rows * GY * SUB;
  const canvas = document.createElement("canvas");
  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "rgb(70 66 62)";
  ctx.fillRect(0, 0, sw, sh);
  const iw = source.videoWidth || source.naturalWidth || source.width;
  const ih = source.videoHeight || source.naturalHeight || source.height;
  if (iw && ih) {
    const cover = Math.max(sw / iw, sh / ih) * pose.zoom;
    ctx.save();
    ctx.translate(sw / 2, sh / 2);
    ctx.rotate(pose.rot);
    if (pose.mirror) ctx.scale(-1, 1);
    ctx.translate(-iw * pose.cx * cover, -ih * pose.cy * cover);
    ctx.drawImage(source, 0, 0, iw * cover, ih * cover);
    ctx.restore();
  }
  const data = ctx.getImageData(0, 0, sw, sh).data;
  const dark = new Float32Array(sw * sh);
  for (let y = 0; y < sh; y += 1) {
    for (let x = 0; x < sw; x += 1) {
      const o = (y * sw + x) * 4;
      let l = (0.2126 * data[o] + 0.7152 * data[o + 1] + 0.0722 * data[o + 2]) / 255;
      l = Math.pow(Math.max(0, l), 0.8);
      l = (l - 0.5) * pose.contrast + 0.5 + pose.exposure + 0.05;
      const nx = (x / sw - 0.5) * 2;
      const ny = (y / sh - 0.45) * 2;
      const r = Math.min(1.6, Math.hypot(nx * 0.95, ny * 0.8));
      l -= 0.12 * Math.pow(r, 2.6);
      const d = Math.min(1, Math.max(0, 1 - l));
      dark[y * sw + x] = Math.pow(d, 1.3);
    }
  }
  return { dark, sw, sh };
}

function drawFrame(ctx, cache, source, pose, fx, fy, rand) {
  const { cellW, cellH, rows, fw, fh } = cache.geo;
  const cols = COLS;
  const { dark, sw, sh } = sampleFrame(source, pose, cols, rows);

  const tone = document.createElement("canvas");
  tone.width = sw;
  tone.height = sh;
  const tctx = tone.getContext("2d");
  const img = tctx.createImageData(sw, sh);
  for (let i = 0; i < dark.length; i += 1) {
    const d = dark[i];
    img.data[i * 4] = PAPER[0] - (PAPER[0] - INK[0]) * d;
    img.data[i * 4 + 1] = PAPER[1] - (PAPER[1] - INK[1]) * d;
    img.data[i * 4 + 2] = PAPER[2] - (PAPER[2] - INK[2]) * d;
    img.data[i * 4 + 3] = 255;
  }
  tctx.putImageData(img, 0, 0);

  const radius = TEX_W * 0.018;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(fx, fy, fw, fh, radius);
  ctx.clip();
  ctx.fillStyle = `rgb(${PAPER.join(" ")})`;
  ctx.fillRect(fx, fy, fw, fh);
  ctx.globalAlpha = 0.62;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(tone, fx, fy, fw, fh);
  ctx.globalAlpha = 1;

  const errs = new Float32Array((cols + 2) * (rows + 1));
  const vec = new Float32Array(GX * GY);
  const regionArea = SUB * SUB;
  ctx.font = cache.font;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      let peak = 0;
      let mean = 0;
      for (let gy = 0; gy < GY; gy += 1) {
        for (let gx = 0; gx < GX; gx += 1) {
          let sum = 0;
          const x0 = (c * GX + gx) * SUB;
          const y0 = (r * GY + gy) * SUB;
          for (let yy = 0; yy < SUB; yy += 1) {
            const row = (y0 + yy) * sw;
            for (let xx = 0; xx < SUB; xx += 1) sum += dark[row + x0 + xx];
          }
          const v = sum / regionArea;
          vec[gy * GX + gx] = v;
          peak = Math.max(peak, v);
          mean += v;
        }
      }
      mean /= vec.length;
      const err = errs[r * (cols + 2) + c + 1];
      if (peak > 1e-3) {
        for (let k = 0; k < vec.length; k += 1) {
          const shaped = peak * Math.pow(vec[k] / peak, 1.8);
          vec[k] = Math.min(1, Math.max(0, shaped * 1.04 + err + (rand() - 0.5) * 0.16 * shaped));
        }
      } else {
        for (let k = 0; k < vec.length; k += 1) vec[k] = Math.max(0, err);
      }
      const g = nearest(cache, vec);
      const diff = clamp((mean + err - g.norm) * 0.8, -0.12, 0.12);
      const at = (rr, cc) => rr * (cols + 2) + cc + 1;
      if (c + 1 < cols) errs[at(r, c + 1)] += diff * (7 / 16);
      if (r + 1 < rows) {
        errs[at(r + 1, c - 1)] += diff * (3 / 16);
        errs[at(r + 1, c)] += diff * (5 / 16);
        errs[at(r + 1, c + 1)] += diff * (1 / 16);
      }
      if (g.char === " ") continue;
      const a = (0.72 + 0.28 * Math.min(1, mean * 1.7)) * (0.9 + rand() * 0.1);
      ctx.fillStyle = `rgba(${INK.join(",")},${a.toFixed(3)})`;
      ctx.fillText(g.char, fx + (c + 0.5) * cellW, fy + (r + 0.5) * cellH + cache.size * 0.04);
    }
  }

  const edge = ctx.createRadialGradient(fx + fw / 2, fy + fh * 0.45, fw * 0.3, fx + fw / 2, fy + fh * 0.45, fw * 0.95);
  edge.addColorStop(0, "rgba(20,16,14,0)");
  edge.addColorStop(0.55, "rgba(20,16,14,0.03)");
  edge.addColorStop(0.8, "rgba(20,16,14,0.08)");
  edge.addColorStop(1, "rgba(20,16,14,0.16)");
  ctx.fillStyle = edge;
  ctx.fillRect(fx, fy, fw, fh);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(fx + 0.5, fy + 0.5, fw - 1, fh - 1, radius);
  ctx.strokeStyle = "rgba(30,24,20,0.14)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

export function poseSet(rand) {
  const j = (s) => (rand() - 0.5) * s;
  return [
    { zoom: 1.02 + j(0.06), cx: 0.5 + j(0.03), cy: 0.47 + j(0.03), rot: -0.035 + j(0.03), exposure: 0.04, contrast: 1.25 },
    { zoom: 1.16 + j(0.08), cx: 0.47 + j(0.04), cy: 0.43 + j(0.03), rot: 0.055 + j(0.03), exposure: 0.06, contrast: 1.3 },
    { zoom: 0.96 + j(0.05), cx: 0.54 + j(0.04), cy: 0.49 + j(0.03), rot: 0.0 + j(0.03), exposure: 0.02, contrast: 1.2 },
    { zoom: 1.3 + j(0.08), cx: 0.5 + j(0.03), cy: 0.41 + j(0.03), rot: -0.07 + j(0.03), exposure: 0.05, contrast: 1.35 },
  ];
}

export function printStrip({ mono, frames, seed = 1, stamp = "" }) {
  const cache = glyphs(mono);
  const rand = mulberry(seed);
  const canvas = document.createElement("canvas");
  canvas.width = TEX_W;
  canvas.height = TEX_H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = `rgb(${PAPER.join(" ")})`;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  for (let i = 0; i < 2600; i += 1) {
    const x = rand() * TEX_W;
    const y = rand() * TEX_H;
    const light = rand() > 0.5;
    ctx.fillStyle = light ? "rgba(255,255,255,0.35)" : "rgba(80,70,60,0.05)";
    ctx.fillRect(x, y, 1 + rand() * 1.5, 1 + rand() * 1.5);
  }

  const { fw, fh } = cache.geo;
  const fx = TEX_W * STRIP.side;
  let fy = TEX_W * (STRIP.stub + STRIP.top);
  frames.forEach((frame) => {
    drawFrame(ctx, cache, frame.source, frame.pose, fx, fy, rand);
    fy += fh + TEX_W * STRIP.gap;
  });

  if (stamp) {
    ctx.save();
    ctx.font = `500 ${Math.round(TEX_W * 0.034)}px ${mono}`;
    ctx.fillStyle = "rgba(60,52,46,0.62)";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(stamp, fx + fw, TEX_H - TEX_W * STRIP.bottom * 0.5);
    ctx.restore();
  }
  return canvas;
}
