import streamImg from "./film-stream.jpg";

export const SUBJECT = { src: streamImg.src };

export const SCENE_W = 640;
export const SCENE_H = 640;
export const FRAME = { anchorX: 0.5, anchorY: 0.62, span: 1.8 };

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export function depthAt(u, v) {
  const bushes = 0.06 * smooth(0.3, 0.5, v);
  const water = smooth(0.5, 1.0, v);
  return Math.min(1, 0.03 + bushes + 0.95 * water * (0.85 + 0.15 * water));
}

export function lightAllowed(u, v) {
  return v > 0.54 && depthAt(u, v) > 0.3;
}

let pixels = null;

export function hueAt(u, v) {
  if (!pixels) return 0;
  const x = Math.min(SCENE_W - 1, Math.max(0, Math.round(u * SCENE_W)));
  const y = Math.min(SCENE_H - 1, Math.max(0, Math.round(v * SCENE_H)));
  const i = (y * SCENE_W + x) * 4;
  const r = pixels[i];
  const g = pixels[i + 1];
  const b = pixels[i + 2];
  if (b > r * 0.96) return 2;
  if (g < r * 0.72) return 1;
  return 0;
}

export function buildScene(photo) {
  const canvas = document.createElement("canvas");
  canvas.width = SCENE_W;
  canvas.height = SCENE_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#060505";
  ctx.fillRect(0, 0, SCENE_W, SCENE_H);
  if (photo) {
    const iw = photo.naturalWidth || photo.videoWidth || photo.width;
    const ih = photo.naturalHeight || photo.videoHeight || photo.height;
    const s = Math.max(SCENE_W / iw, SCENE_H / ih);
    const w = iw * s;
    const h = ih * s;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(photo, (SCENE_W - w) / 2, (SCENE_H - h) / 2, w, h);
  }
  pixels = ctx.getImageData(0, 0, SCENE_W, SCENE_H).data;
  return canvas;
}

export const DEFAULT_SUBJECT = { frame: FRAME, depthAt, allow: lightAllowed, extra: [] };

const GRID = 48;
const USER_PICK = { floor: 0.3, rank: 0.99, hi: 0.58, mean: 0.42, max: 72, spacing: 10, energy: 1.4, focusDepth: 0.3, focusEnergy: 4, restore: true, cap: 3.2 };

function blurGrid(src, n, r) {
  let a = src;
  for (let pass = 0; pass < 2; pass += 1) {
    const b = new Float32Array(n * n);
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        let s = 0;
        let c = 0;
        for (let k = -r; k <= r; k += 1) {
          const xx = Math.min(n - 1, Math.max(0, x + k));
          s += a[y * n + xx];
          c += 1;
        }
        b[y * n + x] = s / c;
      }
    }
    const d = new Float32Array(n * n);
    for (let y = 0; y < n; y += 1) {
      for (let x = 0; x < n; x += 1) {
        let s = 0;
        let c = 0;
        for (let k = -r; k <= r; k += 1) {
          const yy = Math.min(n - 1, Math.max(0, y + k));
          s += b[yy * n + x];
          c += 1;
        }
        d[y * n + x] = s / c;
      }
    }
    a = d;
  }
  return a;
}

export function subjectFor(scene) {
  const n = GRID;
  const small = document.createElement("canvas");
  small.width = n * 4;
  small.height = n * 4;
  const ctx = small.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(scene, 0, 0, small.width, small.height);
  const px = ctx.getImageData(0, 0, small.width, small.height).data;
  const S = small.width;
  const lum = new Float32Array(S * S);
  for (let i = 0; i < S * S; i += 1) lum[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
  const detail = new Float32Array(n * n);
  for (let y = 1; y < S - 1; y += 1) {
    for (let x = 1; x < S - 1; x += 1) {
      const i = y * S + x;
      const g = Math.abs(lum[i + 1] - lum[i - 1]) + Math.abs(lum[i + S] - lum[i - S]);
      detail[Math.floor(y / 4) * n + Math.floor(x / 4)] += g;
    }
  }
  const soft = blurGrid(detail, n, 2);
  const sorted = Array.from(soft).sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.2)];
  const hi = sorted[Math.floor(sorted.length * 0.85)] + 1e-6;
  const depth = new Float32Array(n * n);
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const u = (x + 0.5) / n - 0.5;
      const v = (y + 0.5) / n - 0.5;
      const sharp = smooth(lo, hi, soft[y * n + x]);
      const radial = smooth(0.12, 0.62, Math.hypot(u, v));
      depth[y * n + x] = Math.min(1, 0.04 + 0.96 * (0.62 * (1 - sharp) + 0.38 * radial));
    }
  }
  const field = blurGrid(depth, n, 3);
  const sample = (u, v) => {
    const fx = Math.min(n - 1.001, Math.max(0, u * n - 0.5));
    const fy = Math.min(n - 1.001, Math.max(0, v * n - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const a = field[y0 * n + x0];
    const b = field[y0 * n + x0 + 1];
    const c = field[(y0 + 1) * n + x0];
    const d = field[(y0 + 1) * n + x0 + 1];
    return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
  };
  return { frame: { anchorX: 0.5, anchorY: 0.5, span: 1.5 }, depthAt: sample, allow: () => true, extra: [], pick: USER_PICK };
}
