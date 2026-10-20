import { albumById } from "@/app/lab/_music/catalog";

export const PX = 12;
export const TILE_W = 38 * PX;
export const TILE_H = 35 * PX;
export const GRID = 4;
export const ATLAS_W = TILE_W * GRID;
export const ATLAS_H = TILE_H * GRID;
export const STOCK = "400 · 135";

const SHOTS = [
  ["abbey-road", "left", 0],
  ["revolver", "right", 0],
  ["rubber-soul", "left", 0],
  ["sgt-pepper", "right", 0],
  ["let-it-be", "left", 0],
  ["magical-mystery-tour", "right", 0],
  ["help", "left", 0],
  ["a-hard-days-night", "right", 0],
  ["with-the-beatles", "left", 0],
  ["white-album", "right", 0],
  ["please-please-me", "left", 0],
  ["beatles-for-sale", "right", 0],
  ["abbey-road", "close", 1],
  ["sgt-pepper", "close", 2],
];

export const FRAMES = SHOTS.map(([id, pose, detail]) => {
  const album = albumById(id);
  return { src: album.cover, name: detail ? `${album.title}, close` : album.title, pose, detail, year: album.year };
});

const TABLES = [
  ["#c8b294", "#8e7458", "#4a3a2a"],
  ["#d9d4cc", "#a29a8e", "#5c564e"],
  ["#b7c2c8", "#7f8d96", "#3f4a52"],
  ["#d6c2a0", "#a08460", "#54402c"],
];

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

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image ${src}`));
    img.src = src;
  });
}

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function tileOrigin(t) {
  return [(t % GRID) * TILE_W, Math.floor(t / GRID) * TILE_H];
}

function toCanvasX(x) {
  return (38 - x) * PX;
}

function averageColour(img) {
  const c = makeCanvas(8, 8);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, 8, 8);
  const d = ctx.getImageData(0, 0, 8, 8).data;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < d.length; i += 4) {
    r += d[i];
    g += d[i + 1];
    b += d[i + 2];
  }
  const n = d.length / 4;
  return [r / n, g / n, b / n];
}

function drawRecord(ctx, cx, cy, r, tint) {
  ctx.save();
  ctx.fillStyle = "rgba(0,0,0,0.35)";
  ctx.beginPath();
  ctx.arc(cx + r * 0.05, cy + r * 0.07, r * 1.02, 0, Math.PI * 2);
  ctx.fill();
  const body = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
  body.addColorStop(0, "#2a2a2c");
  body.addColorStop(0.55, "#121214");
  body.addColorStop(1, "#060607");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 0.6;
  for (let k = 0.4; k < 0.97; k += 0.035) {
    ctx.beginPath();
    ctx.arc(cx, cy, r * k, 0, Math.PI * 2);
    ctx.stroke();
  }
  const sheen = ctx.createConicGradient(0.6, cx, cy);
  sheen.addColorStop(0, "rgba(255,255,255,0)");
  sheen.addColorStop(0.08, "rgba(255,255,255,0.16)");
  sheen.addColorStop(0.16, "rgba(255,255,255,0)");
  sheen.addColorStop(0.5, "rgba(255,255,255,0)");
  sheen.addColorStop(0.58, "rgba(255,255,255,0.12)");
  sheen.addColorStop(0.66, "rgba(255,255,255,0)");
  sheen.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = sheen;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.97, 0, Math.PI * 2);
  ctx.arc(cx, cy, r * 0.36, 0, Math.PI * 2, true);
  ctx.fill();
  ctx.fillStyle = `rgb(${tint[0]},${tint[1]},${tint[2]})`;
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.33, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e9e4da";
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.03, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawShot(ctx, img, frame, index, dx, dy, dw, dh) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(dx, dy, dw, dh);
  ctx.clip();
  if (frame.pose === "close") {
    const zoom = frame.detail === 1 ? [0.18, 0.5, 0.62] : [0.3, 0.22, 0.6];
    const sw = img.naturalWidth * zoom[2];
    const sh = sw * (dh / dw);
    ctx.drawImage(img, img.naturalWidth * zoom[0], img.naturalHeight * zoom[1], sw, sh, dx, dy, dw, dh);
    ctx.restore();
    return;
  }
  const [hi, mid, lo] = TABLES[index % TABLES.length];
  const table = ctx.createLinearGradient(dx, dy, dx + dw * 0.3, dy + dh);
  table.addColorStop(0, hi);
  table.addColorStop(0.55, mid);
  table.addColorStop(1, lo);
  ctx.fillStyle = table;
  ctx.fillRect(dx, dy, dw, dh);
  const glow = ctx.createRadialGradient(dx + dw * 0.35, dy + dh * 0.2, 0, dx + dw * 0.35, dy + dh * 0.2, dw * 0.8);
  glow.addColorStop(0, "rgba(255,248,236,0.32)");
  glow.addColorStop(0.5, "rgba(255,248,236,0.08)");
  glow.addColorStop(1, "rgba(255,248,236,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(dx, dy, dw, dh);
  const side = frame.pose === "left" ? -1 : 1;
  const size = dh * 0.8;
  const cx = dx + dw / 2 + side * dw * 0.1;
  const cy = dy + dh / 2;
  const tint = averageColour(img).map((v) => Math.round(v));
  drawRecord(ctx, cx - side * size * 0.42, cy, size * 0.47, tint);
  const tilt = side * 0.035;
  ctx.translate(cx + side * size * 0.06, cy);
  ctx.rotate(tilt);
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = size * 0.06;
  ctx.shadowOffsetX = size * 0.02;
  ctx.shadowOffsetY = size * 0.035;
  ctx.fillStyle = "#111";
  ctx.fillRect(-size / 2, -size / 2, size, size);
  ctx.shadowColor = "transparent";
  ctx.drawImage(img, -size / 2, -size / 2, size, size);
  const edge = ctx.createLinearGradient(-size / 2, -size / 2, size / 2, size / 2);
  edge.addColorStop(0, "rgba(255,255,255,0.14)");
  edge.addColorStop(0.4, "rgba(255,255,255,0)");
  edge.addColorStop(1, "rgba(0,0,0,0.12)");
  ctx.fillStyle = edge;
  ctx.fillRect(-size / 2, -size / 2, size, size);
  ctx.restore();
}

function addGrain(ctx, w, h, seed) {
  const data = ctx.getImageData(0, 0, w, h);
  const px = data.data;
  const rand = rng(seed);
  for (let i = 0; i < px.length; i += 4) {
    const g = (rand() + rand() + rand() - 1.5) * 13;
    const l = (px[i] + px[i + 1] + px[i + 2]) / 765;
    const amt = g * (0.55 + 0.9 * l * (1 - l));
    px[i] = Math.max(0, Math.min(255, px[i] + amt));
    px[i + 1] = Math.max(0, Math.min(255, px[i + 1] + amt * 0.96));
    px[i + 2] = Math.max(0, Math.min(255, px[i + 2] + amt * 1.08));
  }
  ctx.putImageData(data, 0, 0);
}

export function buildPhotoAtlas(images) {
  const canvas = makeCanvas(ATLAS_W, ATLAS_H);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, ATLAS_W, ATLAS_H);
  FRAMES.forEach((frame, i) => {
    const img = images[i];
    if (!img) return;
    const [ox, oy] = tileOrigin(i + 2);
    const x0 = ox + toCanvasX(37);
    const y0 = oy + 5.5 * PX;
    drawShot(ctx, img, frame, i, x0 - 2, y0 - 2, 36 * PX + 4, 24 * PX + 4);
  });
  addGrain(ctx, ATLAS_W, ATLAS_H, 7);
  return canvas;
}

function barcode(ctx, x, y, w, rand) {
  const clock = 0.32 * PX;
  let cx = x;
  while (cx < x + w) {
    ctx.fillRect(cx, y, 0.16 * PX, 0.55 * PX);
    cx += clock;
  }
  cx = x;
  while (cx < x + w) {
    const on = rand() > 0.45;
    const bw = (rand() > 0.6 ? 0.42 : 0.18) * PX;
    if (on) ctx.fillRect(cx, y + 0.72 * PX, bw, 0.6 * PX);
    cx += clock;
  }
}

function arrow(ctx, x, y, s) {
  ctx.beginPath();
  ctx.moveTo(x, y - s / 2);
  ctx.lineTo(x - s * 0.9, y);
  ctx.lineTo(x, y + s / 2);
  ctx.closePath();
  ctx.fill();
}

export function buildDetailAtlas(fontFamily) {
  const canvas = makeCanvas(ATLAS_W, ATLAS_H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, ATLAS_W, ATLAS_H);
  const rand = rng(41);
  const font = `600 ${1.5 * PX}px ${fontFamily}`;
  const small = `600 ${1.15 * PX}px ${fontFamily}`;
  ctx.textBaseline = "middle";
  for (let t = 0; t < 16; t += 1) {
    const [ox, oy] = tileOrigin(t);
    ctx.save();
    ctx.beginPath();
    ctx.rect(ox, oy, TILE_W, TILE_H);
    ctx.clip();
    ctx.globalCompositeOperation = "lighter";
    ctx.fillStyle = "#ff0000";
    const frame = t - 1;
    const bandTop = oy + 1.0 * PX;
    if (t % 2 === 0) {
      ctx.font = font;
      ctx.textAlign = "left";
      ctx.fillText(STOCK, ox + toCanvasX(31), bandTop);
      ctx.font = small;
      ctx.fillText(`${(t * 7 + 3) % 10}`, ox + toCanvasX(8.4), bandTop);
    } else {
      barcode(ctx, ox + toCanvasX(33), oy + 0.25 * PX, 22 * PX, rand);
      ctx.font = small;
      ctx.fillText("◂", ox + toCanvasX(7.6), bandTop);
    }
    if (frame >= 1) {
      const bandBottom = oy + 34.0 * PX;
      ctx.font = font;
      ctx.textAlign = "center";
      ctx.fillText(`${frame}`, ox + toCanvasX(28), bandBottom);
      arrow(ctx, ox + toCanvasX(25.2), bandBottom, 0.9 * PX);
      ctx.fillText(`${frame}A`, ox + toCanvasX(9), bandBottom);
      arrow(ctx, ox + toCanvasX(5.8), bandBottom, 0.9 * PX);
    }
    ctx.fillStyle = "#00ff00";
    const specks = 5 + Math.floor(rand() * 7);
    for (let i = 0; i < specks; i += 1) {
      const r = (0.04 + rand() * rand() * 0.2) * PX;
      ctx.globalAlpha = 0.55 + rand() * 0.45;
      ctx.beginPath();
      ctx.ellipse(ox + rand() * TILE_W, oy + rand() * TILE_H, r, r * (0.6 + rand() * 0.4), rand() * Math.PI, 0, Math.PI * 2);
      ctx.fill();
    }
    if (rand() > 0.62) {
      ctx.strokeStyle = "#00ff00";
      ctx.globalAlpha = 0.85;
      ctx.lineWidth = 0.05 * PX;
      ctx.lineCap = "round";
      const sx = ox + (0.1 + rand() * 0.8) * TILE_W;
      const sy = oy + (0.2 + rand() * 0.6) * TILE_H;
      const len = (2 + rand() * 4) * PX;
      const a = rand() * Math.PI * 2;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.bezierCurveTo(
        sx + Math.cos(a) * len * 0.4 + (rand() - 0.5) * len * 0.6,
        sy + Math.sin(a) * len * 0.4 + (rand() - 0.5) * len * 0.6,
        sx + Math.cos(a) * len * 0.8 + (rand() - 0.5) * len * 0.6,
        sy + Math.sin(a) * len * 0.8 + (rand() - 0.5) * len * 0.6,
        sx + Math.cos(a) * len,
        sy + Math.sin(a) * len,
      );
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#0000ff";
    const lanes = [
      { y: 9.4, from: 120, to: 470, a: 0.55 },
      { y: 21.7, from: 60, to: 330, a: 0.4 },
      { y: 26.2, from: 380, to: 600, a: 0.5 },
    ];
    for (const lane of lanes) {
      const f0 = t * 38;
      const f1 = f0 + 38;
      const a0 = Math.max(f0, lane.from);
      const a1 = Math.min(f1, lane.to);
      if (a1 <= a0) continue;
      ctx.globalAlpha = lane.a;
      ctx.lineWidth = 0.035 * PX;
      ctx.beginPath();
      const steps = 12;
      for (let s = 0; s <= steps; s += 1) {
        const f = a0 + ((a1 - a0) * s) / steps;
        const y = lane.y + Math.sin(f * 0.05 + lane.y) * 0.08;
        const px = ox + toCanvasX(f - f0);
        const py = oy + y * PX;
        if (s === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    ctx.restore();
  }
  return canvas;
}

export function buildLabel(fontFamily) {
  const w = 2048;
  const h = 1024;
  const canvas = makeCanvas(w, h);
  const ctx = canvas.getContext("2d");
  const cobalt = "#1f3c9c";
  const cobaltDeep = "#162d7a";
  const cream = "#f3ecdc";
  const orange = "#ef6a2a";
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, cobaltDeep);
  grad.addColorStop(0.3, cobalt);
  grad.addColorStop(0.5, cobalt);
  grad.addColorStop(0.7, cobalt);
  grad.addColorStop(1, cobaltDeep);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
  const face = (cx) => {
    ctx.save();
    ctx.translate(cx, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillStyle = cream;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.font = `640 210px ${fontFamily}`;
    ctx.fillText("Colour", -90, 40);
    ctx.fillStyle = orange;
    ctx.font = `700 150px ${fontFamily}`;
    ctx.textAlign = "left";
    ctx.fillText("400", 250, 34);
    ctx.fillStyle = cream;
    ctx.font = `500 54px ${fontFamily}`;
    ctx.textAlign = "center";
    ctx.fillText("colour negative film · 135-12", -10, 150);
    ctx.restore();
    ctx.fillStyle = orange;
    ctx.fillRect(cx - 250, 0, 26, h);
    ctx.fillStyle = cream;
    ctx.fillRect(cx - 214, 0, 8, h);
  };
  face(w * 0.5);
  face(w * 0.0);
  face(w * 1.0);
  const rand = rng(5);
  const patchY = h - 150;
  for (let row = 0; row < 2; row += 1) {
    for (let col = 0; col < 6; col += 1) {
      const silver = row === 0 ? col % 2 === 0 || rand() > 0.5 : rand() > 0.4;
      ctx.fillStyle = silver ? "#c9ccd2" : "#17181b";
      ctx.fillRect(w * 0.36 + col * 92, patchY + row * 66, 88, 62);
    }
  }
  return canvas;
}

export function buildTableDust() {
  const size = 1024;
  const canvas = makeCanvas(size, size);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size, size);
  const rand = rng(19);
  ctx.fillStyle = "#fff";
  for (let i = 0; i < 90; i += 1) {
    const r = 0.5 + rand() * rand() * 1.1;
    ctx.globalAlpha = 0.2 + rand() * 0.5;
    ctx.beginPath();
    ctx.arc(rand() * size, rand() * size, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.strokeStyle = "#fff";
  ctx.lineCap = "round";
  for (let i = 0; i < 3; i += 1) {
    ctx.globalAlpha = 0.25 + rand() * 0.2;
    ctx.lineWidth = 0.5 + rand() * 0.3;
    const x = rand() * size;
    const y = rand() * size;
    const len = 14 + rand() * 22;
    const a = rand() * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.bezierCurveTo(
      x + Math.cos(a) * len * 0.3 + (rand() - 0.5) * 30,
      y + Math.sin(a) * len * 0.3 + (rand() - 0.5) * 30,
      x + Math.cos(a) * len * 0.7 + (rand() - 0.5) * 30,
      y + Math.sin(a) * len * 0.7 + (rand() - 0.5) * 30,
      x + Math.cos(a) * len,
      y + Math.sin(a) * len,
    );
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return canvas;
}
