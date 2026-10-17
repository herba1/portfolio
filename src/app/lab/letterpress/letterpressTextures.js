function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function surface(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  return { canvas, ctx: canvas.getContext("2d") };
}

function valueNoise(w, h, cell, rand) {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const grid = new Float32Array(gw * gh);
  for (let i = 0; i < grid.length; i += 1) grid[i] = rand();
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y += 1) {
    const fy = y / cell;
    const iy = Math.floor(fy);
    const ty = fy - iy;
    const sy = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < w; x += 1) {
      const fx = x / cell;
      const ix = Math.floor(fx);
      const tx = fx - ix;
      const sx = tx * tx * (3 - 2 * tx);
      const a = grid[iy * gw + ix];
      const b = grid[iy * gw + ix + 1];
      const c = grid[(iy + 1) * gw + ix];
      const d = grid[(iy + 1) * gw + ix + 1];
      out[y * w + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}

function wrapNoise(size, cells, rand) {
  const grid = new Float32Array(cells * cells);
  for (let i = 0; i < grid.length; i += 1) grid[i] = rand();
  const out = new Float32Array(size * size);
  const k = cells / size;
  for (let y = 0; y < size; y += 1) {
    const fy = y * k;
    const iy = Math.floor(fy);
    const ty = fy - iy;
    const sy = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < size; x += 1) {
      const fx = x * k;
      const ix = Math.floor(fx);
      const tx = fx - ix;
      const sx = tx * tx * (3 - 2 * tx);
      const x1 = (ix + 1) % cells;
      const y1 = (iy + 1) % cells;
      const a = grid[iy * cells + ix];
      const b = grid[iy * cells + x1];
      const c = grid[y1 * cells + ix];
      const d = grid[y1 * cells + x1];
      out[y * size + x] = a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
    }
  }
  return out;
}

export function tableCanvas(size, seed) {
  const { canvas, ctx } = surface(size, size);
  const rand = rng(seed);
  const layers = [wrapNoise(size, 6, rand), wrapNoise(size, 24, rand), wrapNoise(size, 96, rand), wrapNoise(size, 256, rand)];
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i += 1) {
    const n = layers[0][i] * 0.35 + layers[1][i] * 0.3 + layers[2][i] * 0.2 + layers[3][i] * 0.15 - 0.5;
    const v = 216 + n * 9;
    img.data[i * 4] = v + 2;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v - 5;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function ironCanvas(size, seed) {
  const { canvas, ctx } = surface(size, size);
  const rand = rng(seed);
  const a = wrapNoise(size, 8, rand);
  const b = wrapNoise(size, 48, rand);
  const c = wrapNoise(size, 192, rand);
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i += 1) {
    const pit = c[i] > 0.82 ? (c[i] - 0.82) * 3 : 0;
    const v = Math.max(0, Math.min(255, 150 + (a[i] - 0.5) * 70 + (b[i] - 0.5) * 60 + (c[i] - 0.5) * 50 + pit * 120));
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function woodCanvas(w, h, seed, tone) {
  const { canvas, ctx } = surface(w, h);
  const rand = rng(seed);
  const warp = valueNoise(w, h, 64, rand);
  const fine = valueNoise(w, h, 3, rand);
  const streak = valueNoise(w, h, 18, rand);
  const img = ctx.createImageData(w, h);
  const freq = 0.11 + rand() * 0.04;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const ring = x * freq + warp[i] * 9 + Math.sin(y * 0.004 + seed) * 2;
      const f = ring - Math.floor(ring);
      const line = Math.pow(Math.abs(f - 0.5) * 2, 6);
      const n = (fine[i] - 0.5) * 0.05 + (streak[i] - 0.5) * 0.08;
      const k = 1 - line * 0.16 + n;
      img.data[i * 4] = Math.min(255, tone[0] * k);
      img.data[i * 4 + 1] = Math.min(255, tone[1] * k);
      img.data[i * 4 + 2] = Math.min(255, tone[2] * k);
      img.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function tympanCanvas(w, h, seed) {
  const { canvas, ctx } = surface(w, h);
  const rand = rng(seed);
  const a = valueNoise(w, h, 40, rand);
  const b = valueNoise(w, h, 4, rand);
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < w * h; i += 1) {
    const n = (a[i] - 0.5) * 0.1 + (b[i] - 0.5) * 0.05;
    img.data[i * 4] = 206 * (1 + n);
    img.data[i * 4 + 1] = 190 * (1 + n);
    img.data[i * 4 + 2] = 152 * (1 + n * 1.2);
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  ctx.globalAlpha = 0.07;
  ctx.strokeStyle = "#5a4520";
  ctx.lineWidth = 1.2;
  for (let k = 0; k < 9; k += 1) {
    const x = rand() * w;
    const y = rand() * h;
    ctx.beginPath();
    ctx.ellipse(x, y, 30 + rand() * 60, 14 + rand() * 30, rand() * Math.PI, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return canvas;
}

export function slabInkCanvas(w, h, seed) {
  const { canvas, ctx } = surface(w, h);
  const rand = rng(seed);
  const rows = valueNoise(w, h, 3, rand);
  const soft = valueNoise(w, h, 24, rand);
  const blot = valueNoise(w, h, 70, rand);
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const fx = Math.min(x, w - 1 - x) / w;
      const fy = Math.min(y, h - 1 - y) / h;
      const edge = Math.min(1, Math.min(fx * 9, fy * 7) + (blot[i] - 0.5) * 0.9);
      const cover = Math.max(0, Math.min(1, edge * 1.4));
      const track = 0.5 + (rows[y * w + ((x * 0.15) | 0)] - 0.5) * 0.35 + (soft[i] - 0.5) * 0.5;
      img.data[i * 4] = 255 * Math.max(0, Math.min(1, track));
      img.data[i * 4 + 1] = 255 * cover;
      img.data[i * 4 + 2] = 0;
      img.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
