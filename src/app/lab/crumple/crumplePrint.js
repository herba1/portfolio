import { SHEET_H, SHEET_W, rng } from "./crumpleCreases";

export const BORDER = 0.07;
export const FELT = "#cdc7bc";

function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function fontFamily(root, prop) {
  const value = getComputedStyle(root).getPropertyValue(prop).trim();
  return value || "ui-sans-serif, system-ui, sans-serif";
}

export function printCanvas(img, name, number, width, root) {
  const height = Math.round((width * SHEET_H) / SHEET_W);
  const c = canvas(width, height);
  const ctx = c.getContext("2d");
  const paper = ctx.createLinearGradient(0, 0, width, height);
  paper.addColorStop(0, "#f7f3ea");
  paper.addColorStop(0.45, "#f5f0e6");
  paper.addColorStop(1, "#f1ebdf");
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, width, height);
  fibres(ctx, width, height, 7);
  const b = Math.round(BORDER * width);
  const side = width - b * 2;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.filter = "saturate(0.9) contrast(1.05) sepia(0.08) brightness(1.02)";
  ctx.drawImage(img, b, b, side, side);
  ctx.restore();
  const vignette = ctx.createRadialGradient(width / 2, b + side / 2, side * 0.3, width / 2, b + side / 2, side * 0.78);
  vignette.addColorStop(0, "rgba(40, 24, 10, 0)");
  vignette.addColorStop(0.6, "rgba(40, 24, 10, 0.04)");
  vignette.addColorStop(1, "rgba(40, 24, 10, 0.16)");
  ctx.fillStyle = vignette;
  ctx.fillRect(b, b, side, side);
  ctx.strokeStyle = "rgba(30, 20, 10, 0.18)";
  ctx.lineWidth = Math.max(1, width / 900);
  ctx.strokeRect(b + 0.5, b + 0.5, side - 1, side - 1);
  const base = b + side + (height - b - side) * 0.56;
  ctx.fillStyle = "rgba(92, 86, 78, 0.78)";
  ctx.textBaseline = "middle";
  ctx.font = `italic ${Math.round(width * 0.052)}px ui-serif, Georgia, "Times New Roman", serif`;
  ctx.fillText(name, b + width * 0.012, base);
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(92, 86, 78, 0.6)";
  ctx.font = `${Math.round(width * 0.028)}px ${fontFamily(root, "--font-mono")}`;
  ctx.fillText(number, width - b, base + width * 0.004);
  return c;
}

export function backCanvas(width, root) {
  const height = Math.round((width * SHEET_H) / SHEET_W);
  const c = canvas(width, height);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#efe8db";
  ctx.fillRect(0, 0, width, height);
  fibres(ctx, width, height, 3);
  ctx.save();
  ctx.translate(width / 2, height / 2);
  ctx.rotate(-0.42);
  ctx.fillStyle = "rgba(120, 128, 150, 0.16)";
  ctx.font = `${Math.round(width * 0.024)}px ${fontFamily(root, "--font-mono")}`;
  ctx.textAlign = "center";
  const step = width * 0.09;
  for (let row = -12; row <= 12; row += 1) {
    const shift = (row % 2) * width * 0.18;
    for (let col = -3; col <= 3; col += 1) {
      ctx.fillText("herb.art  fibre gloss", col * width * 0.36 + shift, row * step);
    }
  }
  ctx.restore();
  return c;
}

function fibres(ctx, width, height, seed) {
  const rand = rng(seed);
  const image = ctx.getImageData(0, 0, width, height);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * 5;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n * 0.9;
  }
  ctx.putImageData(image, 0, 0);
  ctx.lineCap = "round";
  const count = Math.round((width * height) / 900);
  for (let i = 0; i < count; i += 1) {
    const x = rand() * width;
    const y = rand() * height;
    const a = rand() * Math.PI * 2;
    const len = (2 + rand() * 7) * (width / 512);
    ctx.strokeStyle = rand() < 0.5 ? `rgba(120, 104, 84, ${0.05 + rand() * 0.06})` : `rgba(255, 253, 248, ${0.12 + rand() * 0.12})`;
    ctx.lineWidth = (0.4 + rand() * 0.5) * (width / 512);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
}

export function surfaceCanvas(width) {
  const height = Math.round((width * SHEET_H) / SHEET_W);
  const c = canvas(width, height);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "rgb(60, 230, 0)";
  ctx.fillRect(0, 0, width, height);
  const b = Math.round(BORDER * width);
  ctx.fillStyle = "rgb(255, 128, 0)";
  ctx.fillRect(b, b, width - b * 2, width - b * 2);
  return c;
}

export function feltCanvas(size, seed) {
  const c = canvas(size, size);
  const ctx = c.getContext("2d");
  ctx.fillStyle = FELT;
  ctx.fillRect(0, 0, size, size);
  const rand = rng(seed);
  const image = ctx.getImageData(0, 0, size, size);
  const d = image.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * 14;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(image, 0, 0);
  ctx.lineCap = "round";
  const strokes = Math.round(size * size * 0.035);
  for (let i = 0; i < strokes; i += 1) {
    const x = rand() * size;
    const y = rand() * size;
    const a = rand() * Math.PI * 2;
    const len = 2 + rand() * 9;
    const light = rand() < 0.5;
    ctx.strokeStyle = light ? `rgba(255, 252, 246, ${0.07 + rand() * 0.16})` : `rgba(96, 86, 72, ${0.06 + rand() * 0.12})`;
    ctx.lineWidth = 0.4 + rand() * 0.7;
    const bend = (rand() - 0.5) * len;
    for (const ox of [0, -size, size]) {
      for (const oy of [0, -size, size]) {
        const sx = x + ox;
        const sy = y + oy;
        if (sx < -12 || sy < -12 || sx > size + 12 || sy > size + 12) continue;
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(sx + Math.cos(a) * len * 0.5 - Math.sin(a) * bend, sy + Math.sin(a) * len * 0.5 + Math.cos(a) * bend, sx + Math.cos(a) * len, sy + Math.sin(a) * len);
        ctx.stroke();
      }
    }
  }
  return c;
}

export function blobCanvas(size) {
  const c = canvas(size, size);
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  const stops = [
    [0, 0.62],
    [0.18, 0.5],
    [0.36, 0.32],
    [0.54, 0.16],
    [0.72, 0.06],
    [0.86, 0.015],
    [1, 0],
  ];
  for (const [at, a] of stops) g.addColorStop(at, `rgba(38, 30, 22, ${a})`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}
