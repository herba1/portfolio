export const ART_SIZE = 1024;
export const MAP_SIZE = 160;
export const FELT_SIZE = 512;
export const COVER_SRC = "/monovolt/cosmos-midnight.webp";

export const PRINTS = [
  { x: 0.885, y: 0.47, rx: 0.042, ry: 0.056, rot: 0.42, depth: 0.5 },
  { x: 0.9, y: 0.6, rx: 0.039, ry: 0.052, rot: 0.3, depth: 0.42 },
  { x: 0.168, y: 0.905, rx: 0.036, ry: 0.048, rot: -0.9, depth: 0.42 },
];

export const MUG = { x: 0.705, y: 0.745, r: 0.104 };

export const SWIPE = [
  [0.14, 0.615],
  [0.24, 0.588],
  [0.34, 0.578],
  [0.42, 0.586],
];

const clamp01 = (x) => Math.min(1, Math.max(0, x));

export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash2(x, y, seed) {
  let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 982451653)) | 0;
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

export function fbm(x, y, seed, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    sum += valueNoise(x * freq, y * freq, seed + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}

function wrapNoise(x, y, period, seed) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const m = (q) => ((q % period) + period) % period;
  const a = hash2(m(xi), m(yi), seed);
  const b = hash2(m(xi + 1), m(yi), seed);
  const c = hash2(m(xi), m(yi + 1), seed);
  const d = hash2(m(xi + 1), m(yi + 1), seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

function wrapFbm(u, v, period, seed, octaves) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let p = period;
  for (let i = 0; i < octaves; i += 1) {
    sum += wrapNoise(u * p, v * p, p, seed + i * 17) * amp;
    norm += amp;
    amp *= 0.5;
    p *= 2;
  }
  return sum / norm;
}

function segDistance(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len > 0 ? Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / len)) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function swipeDistance(u, v) {
  let best = Infinity;
  for (let i = 1; i < SWIPE.length; i += 1) {
    const [ax, ay] = SWIPE[i - 1];
    const [bx, by] = SWIPE[i];
    best = Math.min(best, segDistance(u, v, ax, ay, bx, by));
  }
  return best;
}

export function buildDustMap() {
  const n = MAP_SIZE;
  const base = new Float32Array(n * n);
  const order = new Float32Array(n * n);
  for (let j = 0; j < n; j += 1) {
    for (let i = 0; i < n; i += 1) {
      const u = (i + 0.5) / n;
      const v = (j + 0.5) / n;
      let d = 0.8 + 0.36 * (fbm(u * 2.6, v * 2.6, 11) - 0.5) * 2 + 0.14 * (fbm(u * 9, v * 9, 23) - 0.5) * 2;
      const edge = Math.min(u, v, 1 - u, 1 - v);
      d += 0.12 * (1 - Math.min(1, edge / 0.08));
      d += 0.1 * (1 - Math.min(1, Math.hypot(u - 0.3, v - 0.25) / 0.5));
      const sw = swipeDistance(u, v);
      const swipeWidth = 0.016 + 0.005 * Math.sin(u * 40);
      if (sw < swipeWidth * 1.6) {
        const k = Math.min(1, sw / swipeWidth);
        if (k < 1) d *= 0.12 + 0.88 * k * k * k;
        else d *= 1 + 0.4 * (1 - Math.abs(sw / swipeWidth - 1.25) / 0.35);
      }
      const ring = Math.abs(Math.hypot(u - MUG.x, v - MUG.y) - MUG.r);
      if (ring < 0.012) d *= 0.45 + 0.55 * (ring / 0.012);
      for (const p of PRINTS) {
        const c = Math.cos(p.rot);
        const s = Math.sin(p.rot);
        const dx = u - p.x;
        const dy = v - p.y;
        const lx = (c * dx + s * dy) / p.rx;
        const ly = (-s * dx + c * dy) / p.ry;
        const r = Math.hypot(lx, ly);
        if (r < 1) d *= 1 - p.depth * 0.55 * (1 - r * r);
      }
      const idx = j * n + i;
      base[idx] = Math.max(0.1, Math.min(1.35, d));
      order[idx] = fbm(u * 5, v * 5, 41, 3);
    }
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (const o of order) {
    lo = Math.min(lo, o);
    hi = Math.max(hi, o);
  }
  for (let i = 0; i < order.length; i += 1) order[i] = (order[i] - lo) / Math.max(1e-4, hi - lo);
  return { base, order };
}

export function buildFelt() {
  const size = FELT_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size, size);
  const rand = rng(7);
  ctx.lineCap = "round";
  for (let i = 0; i < 7000; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 2 + Math.pow(rand(), 2.2) * 22;
    const a = rand() * Math.PI * 2;
    const bend = (rand() - 0.5) * 1.4;
    const ex = x + Math.cos(a) * len;
    const ey = y + Math.sin(a) * len;
    const mx = (x + ex) / 2 + Math.cos(a + Math.PI / 2) * bend * len * 0.5;
    const my = (y + ey) / 2 + Math.sin(a + Math.PI / 2) * bend * len * 0.5;
    ctx.lineWidth = 0.5 + rand() * 0.8;
    ctx.strokeStyle = `rgba(255,255,255,${(0.08 + rand() * 0.4).toFixed(3)})`;
    for (const ox of [-size, 0, size]) {
      for (const oy of [-size, 0, size]) {
        if ((ox && Math.abs(x + ox - size / 2) > size / 2 + len) || (oy && Math.abs(y + oy - size / 2) > size / 2 + len)) continue;
        ctx.beginPath();
        ctx.moveTo(x + ox, y + oy);
        ctx.quadraticCurveTo(mx + ox, my + oy, ex + ox, ey + oy);
        ctx.stroke();
      }
    }
  }
  const img = ctx.getImageData(0, 0, size, size).data;
  const out = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const k = (j * size + i) * 4;
      const blot = wrapFbm(i / size, j / size, 6, 5, 4);
      out[k] = img[k];
      out[k + 1] = Math.floor(hash2(i, j, 3) * 255);
      out[k + 2] = Math.floor(clamp01((blot - 0.5) * 1.8 + 0.5) * 255);
      out[k + 3] = 255;
    }
  }
  return out;
}

function grey(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size, size);
  return { canvas, ctx };
}

function stickerPath(ctx, w, h) {
  const r = h * 0.16;
  ctx.beginPath();
  ctx.moveTo(-w / 2 + r, -h / 2);
  ctx.lineTo(w / 2 - r, -h / 2);
  ctx.quadraticCurveTo(w / 2, -h / 2, w / 2, -h / 2 + r);
  ctx.lineTo(w / 2, h / 2 - h * 0.34);
  ctx.lineTo(w / 2 - h * 0.3, h / 2);
  ctx.lineTo(-w / 2 + r, h / 2);
  ctx.quadraticCurveTo(-w / 2, h / 2, -w / 2, h / 2 - r);
  ctx.lineTo(-w / 2, -h / 2 + r);
  ctx.quadraticCurveTo(-w / 2, -h / 2, -w / 2 + r, -h / 2);
  ctx.closePath();
}

const STICKER = { x: 0.135, y: 0.1, w: 0.2, h: 0.112, rot: -0.09 };

export function buildCover(img, family) {
  const size = ART_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const side = Math.min(img.naturalWidth, img.naturalHeight);
  const sx = Math.min(img.naturalWidth - side, Math.max(0, img.naturalWidth * 0.235));
  ctx.drawImage(img, sx, 0, side, side, 0, 0, size, size);
  const soft = document.createElement("canvas");
  soft.width = size;
  soft.height = size;
  const softCtx = soft.getContext("2d");
  softCtx.filter = "blur(3px)";
  softCtx.drawImage(canvas, 0, 0);
  const blurred = softCtx.getImageData(0, 0, size, size).data;

  const data = ctx.getImageData(0, 0, size, size);
  const px = data.data;
  for (let k = 0; k < px.length; k += 4) {
    for (let c = 0; c < 3; c += 1) px[k + c] = Math.max(0, Math.min(255, px[k + c] + (px[k + c] - blurred[k + c]) * 0.7));
  }
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const k = (j * size + i) * 4;
      let r = px[k] / 255;
      let g = px[k + 1] / 255;
      let b = px[k + 2] / 255;
      const lum = 0.3 * r + 0.59 * g + 0.11 * b;
      const age = lum * lum * 0.06;
      const sat = 1.18;
      r = lum + (r - lum) * sat;
      g = lum + (g - lum) * sat;
      b = lum + (b - lum) * sat;
      r = r * (1 - age) + age * 0.98;
      g = g * (1 - age) + age * 0.93;
      b = b * (1 - age * 1.3) + age * 0.78;
      const grain = (hash2(i, j, 9) - 0.5) * 0.035 + (fbm(i / 7, j / 7, 13, 2) - 0.5) * 0.03;
      px[k] = Math.max(0, Math.min(255, (r + grain) * 255));
      px[k + 1] = Math.max(0, Math.min(255, (g + grain) * 255));
      px[k + 2] = Math.max(0, Math.min(255, (b + grain) * 255));
    }
  }
  ctx.putImageData(data, 0, 0);

  ctx.save();
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "rgb(22 30 52)";
  ctx.font = `600 58px ${family}`;
  ctx.fillText("Cosmos Midnight", size - 58, 104);
  ctx.font = `450 30px ${family}`;
  ctx.fillStyle = "rgb(38 48 74)";
  ctx.fillText("What Comes Next", size - 60, 146);
  ctx.restore();

  ctx.save();
  ctx.font = `500 18px ${family}`;
  ctx.fillStyle = "rgba(236 232 222 / 0.82)";
  ctx.textAlign = "right";
  ctx.fillText("Side one  ·  33⅓", size - 44, size - 40);
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  const mugs = [
    { x: MUG.x, y: MUG.y, a0: 0, a1: Math.PI * 2, alpha: 1 },
    { x: MUG.x - 0.028, y: MUG.y + 0.02, a0: 2.3, a1: 4.9, alpha: 0.55 },
  ];
  const rand = rng(31);
  for (const m of mugs) {
    const cx = m.x * size;
    const cy = m.y * size;
    const r = MUG.r * size;
    if (m.alpha === 1) {
      const fill = ctx.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
      fill.addColorStop(0, "rgba(176, 128, 74, 0.05)");
      fill.addColorStop(0.7, "rgba(170, 118, 64, 0.1)");
      fill.addColorStop(0.95, "rgba(150, 96, 48, 0.2)");
      fill.addColorStop(1, "rgba(150, 96, 48, 0)");
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fill();
    }
    const steps = 120;
    for (let s = 0; s < steps; s += 1) {
      const a = m.a0 + ((m.a1 - m.a0) * s) / steps;
      const b = m.a0 + ((m.a1 - m.a0) * (s + 1.4)) / steps;
      const strength = (0.25 + 0.75 * fbm(s * 0.08, m.x * 10, 51, 2)) * m.alpha;
      ctx.strokeStyle = `rgba(118, 70, 30, ${(0.55 * strength).toFixed(3)})`;
      ctx.lineWidth = 2.2 + rand() * 2.4;
      ctx.beginPath();
      ctx.arc(cx, cy, r - rand() * 1.5, a, b);
      ctx.stroke();
      ctx.strokeStyle = `rgba(160, 108, 58, ${(0.22 * strength).toFixed(3)})`;
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.arc(cx, cy, r - 6, a, b);
      ctx.stroke();
    }
  }
  ctx.restore();

  ctx.save();
  ctx.translate(STICKER.x * size, STICKER.y * size);
  ctx.rotate(STICKER.rot);
  const sw = STICKER.w * size;
  const sh = STICKER.h * size;
  stickerPath(ctx, sw, sh);
  const paper = ctx.createLinearGradient(-sw / 2, -sh / 2, sw / 2, sh / 2);
  paper.addColorStop(0, "rgb(246 214 170)");
  paper.addColorStop(0.45, "rgb(243 206 160)");
  paper.addColorStop(0.8, "rgb(238 197 152)");
  paper.addColorStop(1, "rgb(232 190 146)");
  ctx.fillStyle = paper;
  ctx.fill();
  ctx.clip();
  ctx.fillStyle = "rgb(196 74 52)";
  ctx.fillRect(-sw / 2, -sh / 2, sw, sh * 0.26);
  ctx.fillStyle = "rgb(250 232 206)";
  ctx.font = `600 15px ${family}`;
  ctx.textAlign = "left";
  ctx.fillText("Basement Records", -sw / 2 + 14, -sh / 2 + 20);
  ctx.fillStyle = "rgb(52 62 128)";
  ctx.font = `italic 500 52px Georgia, "Times New Roman", serif`;
  ctx.fillText("$2", -sw / 2 + 16, sh / 2 - 18);
  ctx.font = `italic 500 30px Georgia, "Times New Roman", serif`;
  ctx.fillText("50", -sw / 2 + 70, sh / 2 - 38);
  ctx.strokeStyle = "rgba(52, 62, 128, 0.85)";
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(-sw / 2 + 112, sh / 2 - 26);
  ctx.quadraticCurveTo(-sw / 2 + 140, sh / 2 - 44, -sw / 2 + 168, sh / 2 - 30);
  ctx.stroke();
  ctx.restore();

  return canvas;
}

export function buildSurface() {
  const size = ART_SIZE;
  const wear = grey(size);
  const rand = rng(19);
  wear.ctx.lineCap = "round";
  const rings = [
    { cx: 0.502, cy: 0.508, r: 0.462, w: 26, alpha: 0.6 },
    { cx: 0.502, cy: 0.508, r: 0.168, w: 10, alpha: 0.34 },
  ];
  for (const ring of rings) {
    const steps = 360;
    for (let s = 0; s < steps; s += 1) {
      const a = (s / steps) * Math.PI * 2;
      const strength = Math.pow(fbm(Math.cos(a) * 2 + 3, Math.sin(a) * 2 + 3, 61, 3), 1.6) * 1.8;
      const alpha = Math.min(1, strength) * ring.alpha;
      if (alpha < 0.04) continue;
      wear.ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`;
      wear.ctx.lineWidth = ring.w * (0.4 + rand() * 0.8);
      wear.ctx.beginPath();
      wear.ctx.arc(ring.cx * size, ring.cy * size, ring.r * size + (rand() - 0.5) * 6, a, a + 0.03);
      wear.ctx.stroke();
    }
  }
  for (let i = 0; i < 900; i += 1) {
    const a = rand() * Math.PI * 2;
    const r = (0.462 + (rand() - 0.5) * 0.03) * size;
    const x = 0.502 * size + Math.cos(a) * r;
    const y = 0.508 * size + Math.sin(a) * r;
    wear.ctx.fillStyle = `rgba(255,255,255,${(rand() * 0.5).toFixed(3)})`;
    wear.ctx.fillRect(x, y, 1 + rand() * 2, 1 + rand() * 2);
  }
  const wearBlur = grey(size);
  wearBlur.ctx.filter = "blur(2px)";
  wearBlur.ctx.drawImage(wear.canvas, 0, 0);

  const sticker = grey(size);
  sticker.ctx.save();
  sticker.ctx.translate(STICKER.x * size, STICKER.y * size);
  sticker.ctx.rotate(STICKER.rot);
  stickerPath(sticker.ctx, STICKER.w * size, STICKER.h * size);
  sticker.ctx.fillStyle = "#fff";
  sticker.ctx.fill();
  sticker.ctx.restore();

  const scratch = grey(size);
  scratch.ctx.lineCap = "round";
  for (let i = 0; i < 90; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 80 + rand() * 360;
    const a = (rand() - 0.5) * 0.24;
    const bow = (rand() - 0.5) * 30;
    scratch.ctx.strokeStyle = `rgba(255,255,255,${(0.15 + rand() * 0.5).toFixed(3)})`;
    scratch.ctx.lineWidth = 0.7 + rand() * 0.9;
    scratch.ctx.beginPath();
    scratch.ctx.moveTo(x, y);
    scratch.ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.5, y + Math.sin(a) * len * 0.5 + bow, x + Math.cos(a) * len, y + Math.sin(a) * len);
    scratch.ctx.stroke();
  }
  for (let i = 0; i < 260; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const len = 6 + rand() * 60;
    const a = rand() * Math.PI * 2;
    scratch.ctx.strokeStyle = `rgba(255,255,255,${(0.1 + rand() * 0.5).toFixed(3)})`;
    scratch.ctx.lineWidth = 0.6 + rand() * 0.8;
    scratch.ctx.beginPath();
    scratch.ctx.moveTo(x, y);
    scratch.ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    scratch.ctx.stroke();
  }

  const smudge = grey(size);
  for (const p of PRINTS) {
    smudge.ctx.save();
    smudge.ctx.translate(p.x * size, p.y * size);
    smudge.ctx.rotate(p.rot);
    smudge.ctx.scale(p.rx * size, p.ry * size);
    const g = smudge.ctx.createRadialGradient(0, 0, 0, 0, 0, 1.15);
    g.addColorStop(0, "rgba(255,255,255,0.75)");
    g.addColorStop(0.55, "rgba(255,255,255,0.5)");
    g.addColorStop(0.85, "rgba(255,255,255,0.18)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    smudge.ctx.fillStyle = g;
    smudge.ctx.beginPath();
    smudge.ctx.arc(0, 0, 1.15, 0, Math.PI * 2);
    smudge.ctx.fill();
    smudge.ctx.restore();
  }

  const read = (c) => c.ctx.getImageData(0, 0, size, size).data;
  const a = read(wearBlur);
  const b = read(sticker);
  const c = read(scratch);
  const d = read(smudge);
  const out = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i += 1) {
    const k = i * 4;
    out[k] = a[k];
    out[k + 1] = b[k];
    out[k + 2] = c[k];
    out[k + 3] = d[k];
  }
  return out;
}

export function buildFibres(count = 18) {
  const rand = rng(97);
  const fibres = [];
  for (let i = 0; i < count; i += 1) {
    const len = 0.03 + Math.pow(rand(), 1.4) * 0.1;
    const points = [];
    const segs = 14;
    let a = rand() * Math.PI * 2;
    let x = 0;
    let y = 0;
    const curl = (rand() - 0.5) * 0.9;
    for (let s = 0; s <= segs; s += 1) {
      points.push([x, y]);
      a += curl * 0.35 + (rand() - 0.5) * 0.5;
      x += Math.cos(a) * (len / segs);
      y += Math.sin(a) * (len / segs);
    }
    const cx = points.reduce((sum, p) => sum + p[0], 0) / points.length;
    const cy = points.reduce((sum, p) => sum + p[1], 0) / points.length;
    for (const p of points) {
      p[0] -= cx;
      p[1] -= cy;
    }
    let u = 0.08 + rand() * 0.84;
    let v = 0.08 + rand() * 0.84;
    if (i < 3) {
      u = [0.6, 0.28, 0.44][i];
      v = [0.36, 0.8, 0.46][i];
    }
    fibres.push({
      home: [u, v],
      points,
      width: 1.2 + rand() * 1.0,
      tone: 0.82 + rand() * 0.14,
      angle: rand() * Math.PI * 2,
    });
  }
  return fibres;
}
