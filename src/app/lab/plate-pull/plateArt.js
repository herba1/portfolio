import { BLOCK_H, BLOCK_W, carveBlock, seeded } from "./plateCarve";

export const PHOTO = "/monovolt/abt7.webp";
const CROP = { x: 12 / 480, y: 108 / 600, w: 352 / 480, h: 440 / 600 };
export const FIBRE_W = 600;
export const FIBRE_H = 750;

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function surface(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return { canvas, ctx };
}

export function blockArt(image) {
  const { ctx } = surface(BLOCK_W, BLOCK_H);
  const iw = image.naturalWidth;
  const ih = image.naturalHeight;
  ctx.imageSmoothingQuality = "high";
  ctx.translate(BLOCK_W, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(image, CROP.x * iw, CROP.y * ih, CROP.w * iw, CROP.h * ih, 0, 0, BLOCK_W, BLOCK_H);
  const data = ctx.getImageData(0, 0, BLOCK_W, BLOCK_H).data;
  const gray = new Float32Array(BLOCK_W * BLOCK_H);
  for (let i = 0; i < gray.length; i += 1) {
    gray[i] = (data[i * 4] * 0.299 + data[i * 4 + 1] * 0.587 + data[i * 4 + 2] * 0.114) / 255;
  }
  const out = carveBlock(gray, BLOCK_W, BLOCK_H, 7);
  return new ImageData(out, BLOCK_W, BLOCK_H);
}

function edgeNoise(rand, count) {
  const pts = [];
  for (let i = 0; i <= count; i += 1) pts.push(rand());
  return (t) => {
    const x = Math.min(0.99999, Math.max(0, t)) * count;
    const i = Math.floor(x);
    const f = x - i;
    const s = f * f * (3 - 2 * f);
    return pts[i] + (pts[i + 1] - pts[i]) * s;
  };
}

export function fibreArt() {
  const w = FIBRE_W;
  const h = FIBRE_H;
  const rand = seeded(29);
  const { ctx } = surface(w, h);
  ctx.fillStyle = "rgb(128,128,128)";
  ctx.fillRect(0, 0, w, h);
  ctx.lineCap = "round";
  for (let i = 0; i < 2600; i += 1) {
    const x = rand() * w;
    const y = rand() * h;
    const long = rand() < 0.22;
    const len = long ? 50 + rand() * 120 : 8 + rand() * 34;
    const a = rand() * Math.PI * 2;
    const bend = (rand() - 0.5) * len * 0.5;
    const ex = x + Math.cos(a) * len;
    const ey = y + Math.sin(a) * len;
    const cx = (x + ex) / 2 - Math.sin(a) * bend;
    const cy = (y + ey) / 2 + Math.cos(a) * bend;
    const light = rand() < 0.7;
    ctx.strokeStyle = light ? `rgba(255,255,255,${0.1 + rand() * 0.22})` : `rgba(0,0,0,${0.05 + rand() * 0.08})`;
    ctx.lineWidth = long ? 0.5 + rand() * 0.7 : 0.6 + rand() * 1.1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(cx, cy, ex, ey);
    ctx.stroke();
  }
  const fibres = ctx.getImageData(0, 0, w, h).data;
  const edgeTop = edgeNoise(rand, 60);
  const edgeBottom = edgeNoise(rand, 60);
  const edgeLeft = edgeNoise(rand, 75);
  const edgeRight = edgeNoise(rand, 75);
  const fineTop = edgeNoise(rand, 300);
  const fineBottom = edgeNoise(rand, 300);
  const fineLeft = edgeNoise(rand, 380);
  const fineRight = edgeNoise(rand, 380);
  const cloudRand = seeded(83);
  const cw = 24;
  const ch = 30;
  const cloud = new Float32Array((cw + 1) * (ch + 1));
  for (let i = 0; i < cloud.length; i += 1) cloud[i] = cloudRand();
  const cloudAt = (u, v) => {
    const x = u * cw;
    const y = v * ch;
    const xi = Math.min(cw - 1, Math.floor(x));
    const yi = Math.min(ch - 1, Math.floor(y));
    const fx = x - xi;
    const fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = cloud[yi * (cw + 1) + xi];
    const b = cloud[yi * (cw + 1) + xi + 1];
    const c = cloud[(yi + 1) * (cw + 1) + xi];
    const d = cloud[(yi + 1) * (cw + 1) + xi + 1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      const u = x / (w - 1);
      const v = y / (h - 1);
      const top = y - (2 + edgeTop(u) * 7 + fineTop(u) * 3);
      const bottom = h - 1 - y - (2 + edgeBottom(u) * 7 + fineBottom(u) * 3);
      const left = x - (2 + edgeLeft(v) * 7 + fineLeft(v) * 3);
      const right = w - 1 - x - (2 + edgeRight(v) * 7 + fineRight(v) * 3);
      const d = Math.min(top, bottom, left, right);
      const fibre = fibres[i * 4] / 255;
      const wisp = Math.max(0, fibre - 0.56) * 6;
      let alpha = Math.min(1, Math.max(0, (d + 1.2) / 3.2));
      if (d < 0.5 && d > -6) alpha = Math.max(alpha, Math.min(1, wisp) * Math.max(0, 1 + d / 6) * 0.9);
      const thinEdge = Math.min(1, Math.max(0, d / 9));
      alpha *= 0.82 + 0.18 * thinEdge;
      out[i * 4] = fibres[i * 4];
      out[i * 4 + 1] = Math.round(alpha * 255);
      out[i * 4 + 2] = Math.round(cloudAt(u, v) * 255);
      out[i * 4 + 3] = 255;
    }
  }
  return new ImageData(out, w, h);
}
