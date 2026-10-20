
export const TYPE_FACE = '"Courier New", "FreeMono", "Nimbus Mono PS", "Courier Prime", Courier, monospace';
export const PRINT_FACE = '"Helvetica Neue", Helvetica, "Liberation Sans", Arial, sans-serif';

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lattice(size, seed) {
  const r = rng(seed);
  const grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i += 1) grid[i] = r();
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const i0 = ((xi % size) + size) % size;
    const j0 = ((yi % size) + size) % size;
    const i1 = (i0 + 1) % size;
    const j1 = (j0 + 1) % size;
    const a = grid[j0 * size + i0];
    const b = grid[j0 * size + i1];
    const c = grid[j1 * size + i0];
    const d = grid[j1 * size + i1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function paper(ctx, w, h, seed, tint) {
  const img = ctx.createImageData(w, h);
  const r = rng(seed);
  const cloud = lattice(48, seed + 3);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = (y * w + x) * 4;
      const n = (r() - 0.5) * 7 + (cloud((x / w) * 24, (y / h) * 24) - 0.5) * 9;
      img.data[i] = tint[0] + n;
      img.data[i + 1] = tint[1] + n;
      img.data[i + 2] = tint[2] + n * 0.9;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  ctx.save();
  ctx.lineWidth = 0.8;
  for (let k = 0; k < (w * h) / 900; k += 1) {
    const x = r() * w;
    const y = r() * h;
    const a = r() * Math.PI * 2;
    const len = 6 + r() * 22;
    ctx.strokeStyle = r() > 0.5 ? "rgb(120 100 70 / 0.07)" : "rgb(255 255 255 / 0.14)";
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a + 0.6) * len * 0.5, y + Math.sin(a + 0.6) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.restore();
}

export function typeText(ctx, text, x, y, size, { ink = "rgb(30 28 36)", seed = 1, align = "left", weight = 0.55 } = {}) {
  ctx.save();
  ctx.font = `${size}px ${TYPE_FACE}`;
  ctx.textBaseline = "alphabetic";
  const advance = ctx.measureText("M").width;
  const total = advance * text.length;
  let cx = align === "right" ? x - total : align === "center" ? x - total / 2 : x;
  const r = rng(seed * 7919 + text.length * 31);
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineWidth = size * 0.03 * weight;
  ctx.shadowColor = ink;
  ctx.shadowBlur = size * 0.035;
  for (const ch of text) {
    if (ch !== " ") {
      const dy = (r() - 0.5) * size * 0.05;
      const dx = (r() - 0.5) * size * 0.03;
      const rot = (r() - 0.5) * 0.035;
      ctx.globalAlpha = 0.72 + r() * 0.26;
      ctx.save();
      ctx.translate(cx + advance / 2 + dx, y + dy);
      ctx.rotate(rot);
      ctx.fillText(ch, -advance / 2, 0);
      ctx.strokeText(ch, -advance / 2, 0);
      if (r() > 0.86) {
        ctx.globalAlpha *= 0.4;
        ctx.fillText(ch, -advance / 2 + size * 0.025, size * 0.012);
      }
      ctx.restore();
    }
    cx += advance;
  }
  ctx.restore();
  return total;
}

function typeFit(ctx, text, x, y, size, maxWidth, options = {}, floor = 0.78) {
  ctx.save();
  ctx.font = `${size}px ${TYPE_FACE}`;
  const advance = ctx.measureText("M").width;
  ctx.restore();
  let fitSize = size;
  let line = String(text);
  if (advance * line.length > maxWidth) fitSize = Math.max(size * floor, maxWidth / line.length / (advance / size));
  const fitAdvance = (advance / size) * fitSize;
  const room = Math.floor(maxWidth / fitAdvance);
  if (line.length > room) line = `${line.slice(0, Math.max(1, room - 1)).trimEnd()}…`;
  return typeText(ctx, line, x, y, fitSize, options);
}

export function labelCanvas(mix) {
  const ppm = 16;
  const w = 76 * ppm;
  const h = 15 * ppm;
  const c = canvas(w, h);
  const ctx = c.getContext("2d");
  paper(ctx, w, h, 41, [240, 233, 218]);
  ctx.fillStyle = "rgb(178 52 40)";
  ctx.fillRect(0, h - 2.2 * ppm, w, 1.1 * ppm);
  ctx.fillStyle = "rgb(36 64 112)";
  ctx.fillRect(0, h - 1.1 * ppm, w, 0.35 * ppm);
  ctx.strokeStyle = "rgb(120 140 170 / 0.45)";
  ctx.lineWidth = 1.2;
  for (const yy of [6.9, 10.9]) {
    ctx.beginPath();
    ctx.moveTo(12.5 * ppm, yy * ppm);
    ctx.lineTo(w - 3 * ppm, yy * ppm);
    ctx.stroke();
  }
  ctx.fillStyle = "rgb(36 64 112)";
  ctx.font = `600 ${9.4 * ppm}px ${PRINT_FACE}`;
  ctx.textBaseline = "alphabetic";
  ctx.fillText("A", 2.4 * ppm, 11.2 * ppm);
  typeFit(ctx, mix.lead.title, 13 * ppm, 6.2 * ppm, 4.2 * ppm, w - 16 * ppm, { ink: "rgb(176 40 34)", seed: 3 });
  typeFit(ctx, [mix.lead.artist, mix.lead.album].filter(Boolean).join(" · "), 13 * ppm, 10.2 * ppm, 3 * ppm, w - 16 * ppm, { seed: 5 });
  return c;
}

export function packCanvas(size) {
  const c = canvas(size, size);
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  const r = rng(301);
  const rings = new Float32Array(1024);
  let drift = 0;
  for (let i = 0; i < rings.length; i += 1) {
    drift += (r() - 0.5) * 0.18;
    drift *= 0.94;
    rings[i] = 0.5 + drift + (r() - 0.5) * 0.25;
  }
  const half = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x + 0.5 - half;
      const dy = y + 0.5 - half;
      const rad = Math.sqrt(dx * dx + dy * dy) / half;
      const idx = Math.min(rings.length - 1, Math.floor(rad * rings.length));
      const g = rings[idx];
      const i = (y * size + x) * 4;
      img.data[i] = 70 + g * 34;
      img.data[i + 1] = 44 + g * 22;
      img.data[i + 2] = 30 + g * 14;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function pencilWoodCanvas() {
  const w = 512;
  const h = 256;
  const c = canvas(w, h);
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(w, h);
  const n = lattice(64, 404);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const u = x / w;
      const v = y / h;
      const warp = n(u * 6, v * 3) * 2.2;
      const ring = u * 34 + warp;
      const f = ring - Math.floor(ring);
      const band = Math.pow(Math.max(0, Math.sin(f * Math.PI)), 5);
      const fib = n(u * 160, v * 6) * 0.5 + n(u * 60 + 5, v * 2) * 0.5;
      const k = band * 0.5 + fib * 0.35;
      const i = (y * w + x) * 4;
      img.data[i] = 222 - k * 52;
      img.data[i + 1] = 178 - k * 52;
      img.data[i + 2] = 132 - k * 46;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function foilCanvas() {
  const ppm = 24;
  const w = 6.2 * ppm;
  const h = 60 * ppm;
  const c = canvas(w, h);
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${3.2 * ppm}px ${PRINT_FACE}`;
  ctx.fillText("HB", 24 * ppm, 0);
  ctx.restore();
  return c;
}

export function endGrainCanvas() {
  const size = 256;
  const c = canvas(size, size);
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  const n = lattice(32, 88);
  const half = size / 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x - half) / half;
      const dy = (y - half) / half;
      const rr = Math.sqrt((dx + 1.8) * (dx + 1.8) + dy * dy) * 9 + n(x / 20, y / 20) * 0.8;
      const f = rr - Math.floor(rr);
      const band = Math.pow(Math.max(0, Math.sin(f * Math.PI)), 4);
      const i = (y * size + x) * 4;
      const core = Math.sqrt(dx * dx + dy * dy) < 0.27;
      img.data[i] = core ? 52 : 214 - band * 44;
      img.data[i + 1] = core ? 52 : 172 - band * 44;
      img.data[i + 2] = core ? 56 : 128 - band * 40;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function blobCanvas(w, h, inset, blur) {
  const c = canvas(w, h);
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(w, h);
  const r = Math.min(w, h) * 0.12;
  const hx = w / 2 - inset;
  const hy = h / 2 - inset;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const qx = Math.abs(x + 0.5 - w / 2) - (hx - r);
      const qy = Math.abs(y + 0.5 - h / 2) - (hy - r);
      const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
      const t = Math.min(1, Math.max(0, 0.5 - outside / (blur * 2)));
      const a = t * t * (3 - 2 * t);
      const i = (y * w + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = Math.round(a * 255);
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}
