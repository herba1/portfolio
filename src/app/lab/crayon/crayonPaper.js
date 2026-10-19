export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hash(x, y, s) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s, 2147483647)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function valueNoise(x, y, s = 0, px = 0, py = 0) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const wx = (v) => (px ? ((v % px) + px) % px : v);
  const wy = (v) => (py ? ((v % py) + py) % py : v);
  const a = hash(wx(ix), wy(iy), s);
  const b = hash(wx(ix + 1), wy(iy), s);
  const c = hash(wx(ix), wy(iy + 1), s);
  const d = hash(wx(ix + 1), wy(iy + 1), s);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x, y, s, octaves) {
  let total = 0;
  let amp = 0.5;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    total += amp * valueNoise(x, y, s + i * 17);
    norm += amp;
    x *= 2.03;
    y *= 2.03;
    amp *= 0.5;
  }
  return total / norm;
}

const DEEP = [10, 34, 92];
const MID = [24, 74, 160];
const LIGHT = [58, 112, 196];

export function paperTexture() {
  const w = 480;
  const h = 320;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(w, h);
  const data = image.data;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const u = x / 75;
      const v = y / 75;
      const wx = fbm(u * 0.7, v * 0.7, 3, 3);
      const wy = fbm(u * 0.7 + 5.2, v * 0.7 + 1.3, 9, 3);
      const n = fbm(u + wx * 1.1, v + wy * 1.1, 21, 5);
      const crease = Math.abs(fbm(u * 1.6 + 9, v * 1.6 + wx, 40, 4) - 0.5) * 2;
      let t = Math.min(1, Math.max(0, (n - 0.3) * 2.1));
      t = t * (0.82 + 0.18 * crease);
      const fine = (hash(x, y, 5) - 0.5) * 4;
      const i = (y * w + x) * 4;
      let r;
      let g;
      let b;
      if (t < 0.5) {
        const k = t / 0.5;
        r = DEEP[0] + (MID[0] - DEEP[0]) * k;
        g = DEEP[1] + (MID[1] - DEEP[1]) * k;
        b = DEEP[2] + (MID[2] - DEEP[2]) * k;
      } else {
        const k = (t - 0.5) / 0.5;
        r = MID[0] + (LIGHT[0] - MID[0]) * k;
        g = MID[1] + (LIGHT[1] - MID[1]) * k;
        b = MID[2] + (LIGHT[2] - MID[2]) * k;
      }
      data[i] = r + fine;
      data[i + 1] = g + fine;
      data[i + 2] = b + fine * 1.4;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function grainTile() {
  const size = 192;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i += 1) {
    const v = hash(i % size, Math.floor(i / size), 77);
    const o = i * 4;
    const light = v > 0.5;
    image.data[o] = light ? 200 : 0;
    image.data[o + 1] = light ? 215 : 8;
    image.data[o + 2] = light ? 255 : 30;
    image.data[o + 3] = Math.floor(Math.abs(v - 0.5) * 2 * 26);
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function toothTile() {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const tile = (cells, stretch, s) => valueNoise((x / size) * cells, (y / size) * (cells / stretch), s, cells, cells / stretch);
      const n = tile(64, 2, 1) * 0.55 + tile(128, 1, 2) * 0.3 + hash(x, y, 3) * 0.15;
      const a = Math.min(1, Math.max(0, (n - 0.24) / 0.26));
      const o = (y * size + x) * 4;
      image.data[o] = 250;
      image.data[o + 1] = 251;
      image.data[o + 2] = 255;
      image.data[o + 3] = Math.floor(a * a * 255);
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function paintOrange(radius, seed, dpr) {
  const rnd = mulberry(seed);
  const pad = Math.ceil(radius * 0.06) + 2;
  const size = Math.ceil((radius + pad) * 2);
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(size * dpr);
  canvas.height = Math.ceil(size * dpr);
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  const c = size / 2;
  const path = new Path2D();
  const steps = 72;
  for (let i = 0; i <= steps; i += 1) {
    const a = (i / steps) * Math.PI * 2;
    const wobble = 1 + (valueNoise(Math.cos(a) * 2 + 3, Math.sin(a) * 2 + 3, seed) - 0.5) * 0.05 + (rnd() - 0.5) * 0.006;
    const x = c + Math.cos(a) * radius * wobble;
    const y = c + Math.sin(a) * radius * wobble;
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  path.closePath();
  ctx.save();
  ctx.clip(path);
  const base = ctx.createRadialGradient(c - radius * 0.3, c - radius * 0.34, radius * 0.05, c, c, radius * 1.05);
  base.addColorStop(0, "#ffc061");
  base.addColorStop(0.28, "#fca33a");
  base.addColorStop(0.62, "#f2861d");
  base.addColorStop(0.86, "#de6a10");
  base.addColorStop(1, "#b9520b");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  const palette = ["255, 178, 80", "246, 140, 36", "230, 110, 20", "255, 196, 110", "214, 92, 12"];
  for (let i = 0; i < 160; i += 1) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * radius;
    const x = c + Math.cos(a) * d;
    const y = c + Math.sin(a) * d;
    const r = radius * (0.02 + rnd() * 0.07);
    ctx.fillStyle = `rgba(${palette[Math.floor(rnd() * palette.length)]}, ${(0.05 + rnd() * 0.08).toFixed(3)})`;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * (0.5 + rnd() * 0.5), rnd() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < radius * 3; i += 1) {
    const a = rnd() * Math.PI * 2;
    const d = Math.sqrt(rnd()) * radius;
    ctx.fillStyle = `rgba(180, 80, 0, ${(0.04 + rnd() * 0.06).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(c + Math.cos(a) * d, c + Math.sin(a) * d, 0.5 + rnd() * 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
  const shade = ctx.createRadialGradient(c - radius * 0.2, c - radius * 0.25, radius * 0.5, c, c, radius * 1.02);
  shade.addColorStop(0, "rgba(120, 40, 0, 0)");
  shade.addColorStop(0.75, "rgba(120, 40, 0, 0.06)");
  shade.addColorStop(1, "rgba(110, 34, 0, 0.32)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, size, size);
  ctx.filter = `blur(${Math.max(2, radius * 0.08).toFixed(1)}px)`;
  ctx.fillStyle = "rgba(255, 236, 190, 0.32)";
  ctx.beginPath();
  ctx.ellipse(c - radius * 0.34, c - radius * 0.4, radius * 0.24, radius * 0.15, -0.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.filter = "none";
  ctx.restore();
  ctx.strokeStyle = "rgba(140, 56, 6, 0.4)";
  ctx.lineWidth = 1;
  ctx.stroke(path);
  return { canvas, size };
}
