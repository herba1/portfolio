import { albumById } from "@/app/lab/_music/catalog";

export const INK = "#1c1a24";
export const PAPER = "#f6f1e4";
export const PAPER_BACK = "#e8e1cf";
export const ACCENT = "#e2412f";

export const SHEETS = [
  {
    key: "setlist",
    label: "Setlist",
    aspect: 0.72,
    title: "Shea Stadium setlist, 15 August 1965",
    songs: [
      "Twist and Shout",
      "She's a Woman",
      "I Feel Fine",
      "Dizzy Miss Lizzy",
      "Ticket to Ride",
      "Everybody's Trying to Be My Baby",
      "Can't Buy Me Love",
      "Baby's in Black",
      "Act Naturally",
      "A Hard Day's Night",
      "Help!",
      "I'm Down",
    ],
  },
  {
    key: "poster",
    label: "Poster",
    aspect: 0.7,
    title: "Abbey Road poster, 1969",
    album: "abbey-road",
  },
];

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function fonts(root) {
  const cs = getComputedStyle(root);
  return {
    sans: cs.getPropertyValue("--font-sans").trim() || "system-ui, sans-serif",
    mono: cs.getPropertyValue("--font-mono").trim() || "ui-monospace, monospace",
  };
}

function fit(ctx, text, max, weight, size, family) {
  let px = size;
  for (let i = 0; i < 20; i += 1) {
    ctx.font = `${weight} ${px}px ${family}`;
    if (ctx.measureText(text).width <= max) break;
    px *= 0.95;
  }
  return px;
}

function halftoneImage(ctx, img, x, y, w, h, pitch) {
  const sw = Math.ceil(w / pitch) + 2;
  const sh = Math.ceil(h / pitch) + 2;
  const small = document.createElement("canvas");
  small.width = sw;
  small.height = sh;
  const sctx = small.getContext("2d", { willReadFrequently: true });
  sctx.drawImage(img, 0, 0, sw, sh);
  const px = sctx.getImageData(0, 0, sw, sh).data;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.fillStyle = PAPER;
  ctx.fillRect(x, y, w, h);
  for (let j = 0; j < sh; j += 1) {
    for (let i = 0; i < sw; i += 1) {
      const o = (j * sw + i) * 4;
      const r = px[o];
      const g = px[o + 1];
      const b = px[o + 2];
      const lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
      const rad = pitch * 0.72 * Math.sqrt(Math.max(0.04, 1 - lum * 0.92));
      const cx = x + i * pitch + (j % 2 ? pitch / 2 : 0);
      const cy = y + j * pitch;
      const k = 1.25;
      ctx.fillStyle = `rgb(${Math.min(255, r * k)} ${Math.min(255, g * k)} ${Math.min(255, b * k)})`;
      ctx.beginPath();
      ctx.arc(cx, cy, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
  ctx.lineWidth = Math.max(2, w * 0.008);
  ctx.strokeStyle = INK;
  ctx.strokeRect(x, y, w, h);
}

function drawSetlist(ctx, w, h, sheet, f) {
  const m = w * 0.1;
  ctx.fillStyle = INK;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.font = `600 ${w * 0.034}px ${f.mono}`;
  ctx.fillText("The Beatles", m, m + w * 0.02);
  ctx.fillText("Shea Stadium, New York", m, m + w * 0.07);
  ctx.textAlign = "right";
  ctx.fillText("15.08.1965", w - m, m + w * 0.02);
  ctx.textAlign = "left";
  ctx.fillStyle = ACCENT;
  ctx.fillRect(m, m + w * 0.105, w - m * 2, w * 0.012);
  const top = m + w * 0.2;
  const step = (h - top - m * 1.2) / sheet.songs.length;
  sheet.songs.forEach((song, i) => {
    const y = top + i * step + step * 0.62;
    ctx.fillStyle = ACCENT;
    ctx.font = `600 ${w * 0.04}px ${f.mono}`;
    ctx.fillText(String(i + 1).padStart(2, "0"), m, y);
    ctx.fillStyle = INK;
    const px = fit(ctx, song, w - m * 2 - w * 0.12, 700, w * 0.066, f.sans);
    ctx.font = `700 ${px}px ${f.sans}`;
    ctx.fillText(song, m + w * 0.12, y);
  });
}

function drawPoster(ctx, w, h, sheet, f, cover) {
  const m = w * 0.08;
  const size = w - m * 2;
  halftoneImage(ctx, cover, m, m, size, size, Math.max(5, w * 0.014));
  ctx.fillStyle = INK;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  const room = h - m - (m + size);
  const px = fit(ctx, "Abbey Road", size, 800, room * 0.42, f.sans);
  ctx.font = `800 ${px}px ${f.sans}`;
  const ty = m + size + room * 0.5;
  ctx.fillText("Abbey Road", m - px * 0.04, ty);
  ctx.fillStyle = ACCENT;
  ctx.fillRect(m, ty + room * 0.1, size, w * 0.012);
  ctx.font = `600 ${w * 0.036}px ${f.mono}`;
  ctx.fillStyle = INK;
  ctx.fillText("The Beatles", m, ty + room * 0.3);
  ctx.textAlign = "right";
  ctx.fillText("26.09.1969", w - m, ty + room * 0.3);
  ctx.textAlign = "left";
}

export async function paintSheet(sheet, width, root) {
  const height = Math.round(width / sheet.aspect);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, width, height);
  const f = fonts(root);
  if (sheet.album) {
    const cover = await loadImage(albumById(sheet.album).cover);
    drawPoster(ctx, width, height, sheet, f, cover);
  } else drawSetlist(ctx, width, height, sheet, f);
  return canvas;
}

export function dotPattern(ctx, pitch, radius, color) {
  const tile = document.createElement("canvas");
  const size = Math.max(2, Math.round(pitch));
  tile.width = size;
  tile.height = size;
  const t = tile.getContext("2d");
  t.fillStyle = color;
  const r = Math.min(size * 0.7, radius);
  for (const [x, y] of [
    [0, 0],
    [size, 0],
    [0, size],
    [size, size],
    [size / 2, size / 2],
  ]) {
    t.beginPath();
    t.arc(x, y, r, 0, Math.PI * 2);
    t.fill();
  }
  return ctx.createPattern(tile, "repeat");
}

export function hatchPattern(ctx, pitch, width, color) {
  const tile = document.createElement("canvas");
  const size = Math.max(3, Math.round(pitch));
  tile.width = size;
  tile.height = size;
  const t = tile.getContext("2d");
  t.strokeStyle = color;
  t.lineWidth = width;
  t.lineCap = "square";
  for (const o of [-size, 0, size]) {
    t.beginPath();
    t.moveTo(o, size);
    t.lineTo(o + size, 0);
    t.stroke();
  }
  return ctx.createPattern(tile, "repeat");
}
