export const PX = 12;
export const TILE_W = 38 * PX;
export const TILE_H = 35 * PX;
export const GRID = 4;
export const ATLAS_W = TILE_W * GRID;
export const ATLAS_H = TILE_H * GRID;
export const STOCK = "Volta 400-5";

export const FRAMES = [
  { src: "/scorch/valley.webp", name: "Valley" },
  { src: "/monovolt/louis-the-child.webp", name: "Louis the Child" },
  { src: "/scorch/beams.webp", name: "Beams" },
  { src: "/monovolt/abt7.webp", name: "Booth", turn: true },
  { src: "/scorch/meadow.webp", name: "Meadow" },
  { src: "/monovolt/lp-giobbi.webp", name: "LP Giobbi" },
  { src: "/scorch/reading.webp", name: "Reading" },
  { src: "/monovolt/abt1.webp", name: "Floor", turn: true },
  { src: "/monovolt/cosmos-midnight.webp", name: "Cosmos Midnight" },
  { src: "/scorch/visitor.webp", name: "Visitor" },
  { src: "/monovolt/abt5.webp", name: "Shelves", turn: true },
  { src: "/scorch/wires.webp", name: "Wires" },
  { src: "/scorch/clock.webp", name: "Clock" },
  { src: "/monovolt/abt10.webp", name: "Lights", turn: true },
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

function drawCover(ctx, img, dx, dy, dw, dh, turn) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(dx, dy, dw, dh);
  ctx.clip();
  ctx.translate(dx + dw / 2, dy + dh / 2);
  let w = dw;
  let h = dh;
  if (turn) {
    ctx.rotate(-Math.PI / 2);
    w = dh;
    h = dw;
  }
  const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight);
  const iw = img.naturalWidth * scale;
  const ih = img.naturalHeight * scale;
  ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);
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
    drawCover(ctx, img, x0 - 2, y0 - 2, 36 * PX + 4, 24 * PX + 4, frame.turn);
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
    ctx.fillText("Volta", -40, 40);
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
