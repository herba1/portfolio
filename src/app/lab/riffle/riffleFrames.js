import { ALBUMS } from "@/app/lab/_music/catalog";

export const PAGES = ALBUMS;
export const FRAMES = PAGES.length;
export const PAGE_ASPECT = 0.8;
export const WIDE_ASPECT = 1.5;

const INK = "#17161c";
const INK_SECONDARY = "#3c3a44";
const PAPER = "#fbf9f4";

export function loadCovers() {
  return Promise.all(
    PAGES.map(
      (album) =>
        new Promise((resolve) => {
          const img = new Image();
          img.decoding = "async";
          img.onload = () => resolve(img);
          img.onerror = () => resolve(null);
          img.src = album.cover;
        }),
    ),
  );
}

function wrap(ctx, text, max) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > max) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function drawCover(ctx, img, x, y, size) {
  ctx.save();
  ctx.shadowColor = "rgb(23 22 28 / 0.2)";
  ctx.shadowBlur = Math.max(8, size * 0.04);
  ctx.shadowOffsetY = Math.max(2, size * 0.01);
  ctx.fillStyle = "#e9e5db";
  ctx.fillRect(x, y, size, size);
  ctx.restore();
  if (img) {
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, x, y, size, size);
  }
  ctx.strokeStyle = "rgb(23 22 28 / 0.16)";
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, size - 1, size - 1);
}

function drawWide(ctx, i, album, img, w, h, fonts) {
  const m = Math.round(h * 0.07);
  const size = h - m * 2;
  drawCover(ctx, img, m, m, size);
  const cx = m + size + Math.round(m * 1.1);
  const colW = w - cx - m;
  let title = Math.round(h * 0.052);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.font = `600 ${title}px ${fonts.sans}`;
  let lines = wrap(ctx, album.title, colW);
  if (lines.length > 2) {
    title = Math.round(h * 0.042);
    ctx.font = `600 ${title}px ${fonts.sans}`;
    lines = wrap(ctx, album.title, colW).slice(0, 3);
  }
  const lead = Math.round(title * 1.14);
  let y = m + Math.round(title * 0.82);
  ctx.fillStyle = INK;
  lines.forEach((line, k) => ctx.fillText(line, cx, y + k * lead));
  y += (lines.length - 1) * lead;
  const small = Math.max(12, Math.round(h * 0.026));
  ctx.font = `500 ${small}px ${fonts.mono}`;
  ctx.fillStyle = INK_SECONDARY;
  y += Math.round(small * 2);
  ctx.fillText(`${album.artist} · ${album.year}`, cx, y);
  const body = Math.max(12, Math.round(h * 0.029));
  const row = Math.round(body * 1.9);
  y += Math.round(row * 1.5);
  ctx.strokeStyle = "rgb(23 22 28 / 0.12)";
  ctx.lineWidth = 1;
  (album.tracks || []).slice(0, 6).forEach((track, k) => {
    const ty = y + k * row;
    if (ty > h - m - row) return;
    ctx.font = `500 ${small}px ${fonts.mono}`;
    ctx.fillStyle = INK_SECONDARY;
    ctx.fillText(String(k + 1), cx, ty);
    ctx.font = `460 ${body}px ${fonts.sans}`;
    ctx.fillStyle = INK;
    const label = wrap(ctx, track, colW - body * 2)[0];
    ctx.fillText(label === track ? track : `${label}…`, cx + body * 2, ty);
    ctx.beginPath();
    ctx.moveTo(cx, Math.round(ty + row * 0.42) + 0.5);
    ctx.lineTo(cx + colW, Math.round(ty + row * 0.42) + 0.5);
    ctx.stroke();
  });
  ctx.font = `500 ${small}px ${fonts.mono}`;
  ctx.textAlign = "right";
  ctx.fillStyle = INK;
  ctx.fillText(String(i + 1).padStart(2, "0"), w - m, h - m);
  ctx.textAlign = "left";
}

export function drawPage(ctx, index, w, h, covers, fonts) {
  const i = ((index % FRAMES) + FRAMES) % FRAMES;
  const album = PAGES[i];
  const img = covers[i];
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);
  if (w > h) {
    drawWide(ctx, i, album, img, w, h, fonts);
    return;
  }
  const m = Math.round(w * 0.07);
  const size = w - m * 2;
  drawCover(ctx, img, m, m, size);

  const small = Math.max(12, Math.round(w * 0.036));
  let title = Math.round(w * 0.066);
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.font = `600 ${title}px ${fonts.sans}`;
  let lines = wrap(ctx, album.title, size);
  if (lines.length > 1) {
    title = Math.round(w * 0.05);
    ctx.font = `600 ${title}px ${fonts.sans}`;
    lines = wrap(ctx, album.title, size).slice(0, 2);
  }
  const top = m + size + Math.round(w * 0.05);
  const lead = Math.round(title * 1.12);
  ctx.fillStyle = INK;
  lines.forEach((line, k) => ctx.fillText(line, m, top + title * 0.8 + k * lead));
  const metaY = h - m;
  ctx.font = `500 ${small}px ${fonts.mono}`;
  ctx.fillStyle = INK_SECONDARY;
  ctx.fillText(String(album.year), m, metaY);
  ctx.textAlign = "right";
  ctx.fillStyle = INK;
  ctx.fillText(String(i + 1).padStart(2, "0"), w - m, metaY);
}
