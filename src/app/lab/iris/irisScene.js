export const SUBJECT = { src: "/scorch/beams.webp" };

export const SCENE_W = 640;
export const SCENE_H = 640;
export const FRAME = { anchorX: 0.6, anchorY: 0.55, span: 1.5 };

const LAMPS = [{ u: 0.598, v: 0.568, energy: 150, sigma: 3, hue: 0 }];

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

function ellipse(u, v, cx, cy, rx, ry, soft) {
  const d = Math.hypot((u - cx) / rx, (v - cy) / ry);
  return 1 - smooth(1 - soft, 1 + soft, d);
}

function nearMask(u, v) {
  const car = ellipse(u, v, 0.2, 0.67, 0.29, 0.13, 0.08) * smooth(0.54, 0.57, v);
  const sitter = ellipse(u, v, 0.775, 0.615, 0.055, 0.075, 0.12);
  const friend = ellipse(u, v, 0.915, 0.61, 0.07, 0.08, 0.12);
  return Math.max(car, sitter, friend);
}

export function depthAt(u, v) {
  const ground = smooth(0.53, 0.56, v);
  const sand = 1 - 0.9 * smooth(0.56, 0.86, v);
  const far = 1 - ground + ground * sand;
  return Math.min(far, 1 - 0.9 * nearMask(u, v));
}

export function lightAllowed(u, v) {
  return v < 0.545 && depthAt(u, v) > 0.6 && Math.hypot(u - LAMPS[0].u, v - LAMPS[0].v) > 0.11;
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

export function extraLights() {
  return LAMPS;
}

export function buildScene(photo) {
  const canvas = document.createElement("canvas");
  canvas.width = SCENE_W;
  canvas.height = SCENE_H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#060505";
  ctx.fillRect(0, 0, SCENE_W, SCENE_H);
  if (photo) {
    const iw = photo.naturalWidth || photo.width;
    const ih = photo.naturalHeight || photo.height;
    const s = Math.max(SCENE_W / iw, SCENE_H / ih);
    const w = iw * s;
    const h = ih * s;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(photo, (SCENE_W - w) / 2, (SCENE_H - h) / 2, w, h);
  }
  pixels = ctx.getImageData(0, 0, SCENE_W, SCENE_H).data;
  return canvas;
}
