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

export function extraLights() {
  return [];
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
