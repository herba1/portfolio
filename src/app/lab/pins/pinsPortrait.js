export const PORTRAIT_SRC = "/cast/john.webp";

const SIZE = 200;

function smoothstep(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function blur(src, w, h, radius) {
  const tmp = new Float32Array(w * h);
  const out = new Float32Array(w * h);
  const r = Math.max(1, Math.round(radius));
  const span = r * 2 + 1;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let sum = 0;
      for (let k = -r; k <= r; k += 1) sum += src[y * w + Math.min(w - 1, Math.max(0, x + k))];
      tmp[y * w + x] = sum / span;
    }
  }
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      let sum = 0;
      for (let k = -r; k <= r; k += 1) sum += tmp[Math.min(h - 1, Math.max(0, y + k)) * w + x];
      out[y * w + x] = sum / span;
    }
  }
  return out;
}

export async function loadRelief(src = PORTRAIT_SRC) {
  const img = new Image();
  img.decoding = "async";
  img.src = src;
  await img.decode();
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, SIZE, SIZE);
  const data = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const lum = new Float32Array(SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i += 1) {
    const r = Math.pow(data[i * 4] / 255, 2.2);
    const g = Math.pow(data[i * 4 + 1] / 255, 2.2);
    const b = Math.pow(data[i * 4 + 2] / 255, 2.2);
    lum[i] = Math.pow(0.2126 * r + 0.7152 * g + 0.0722 * b, 1 / 2.2);
  }
  let wide = blur(lum, SIZE, SIZE, 5);
  wide = blur(wide, SIZE, SIZE, 4);
  const fine = blur(lum, SIZE, SIZE, 1);
  const relief = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const i = y * SIZE + x;
      const base = 0.55 * wide[i] + 0.45 * fine[i];
      const dx = (x / SIZE - 0.5) / 0.36;
      const dy = (y / SIZE - 0.5) / 0.48;
      const dome = Math.exp(-(dx * dx + dy * dy) * 1.3);
      const h = smoothstep(0.06, 0.8, base);
      relief[i] = Math.min(1, h * (0.45 + 0.55 * dome) + 0.14 * dome * smoothstep(0.02, 0.2, base));
    }
  }
  return { size: SIZE, relief };
}

export function sampleRelief(source, u, v) {
  if (u < 0 || u > 1 || v < 0 || v > 1) return 0;
  const n = source.size;
  const x = u * (n - 1);
  const y = v * (n - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(n - 1, x0 + 1);
  const y1 = Math.min(n - 1, y0 + 1);
  const fx = x - x0;
  const fy = y - y0;
  const r = source.relief;
  const a = r[y0 * n + x0] + (r[y0 * n + x1] - r[y0 * n + x0]) * fx;
  const b = r[y1 * n + x0] + (r[y1 * n + x1] - r[y1 * n + x0]) * fx;
  return a + (b - a) * fy;
}
