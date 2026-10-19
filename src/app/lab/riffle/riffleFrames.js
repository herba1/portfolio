import { ALBUMS } from "@/app/lab/_music/catalog";

export const PAGES = ALBUMS;
export const FRAMES = PAGES.length;
export const PAGE_ASPECT = 0.8;

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

export function drawPage(ctx, index, w, h, covers, fonts) {
  const i = ((index % FRAMES) + FRAMES) % FRAMES;
  const album = PAGES[i];
  const img = covers[i];
  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, w, h);
  const m = Math.round(w * 0.07);
  const size = w - m * 2;
  if (img) {
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, (img.naturalWidth - side) / 2, (img.naturalHeight - side) / 2, side, side, m, m, size, size);
  } else {
    ctx.fillStyle = "#e9e5db";
    ctx.fillRect(m, m, size, size);
  }
  ctx.strokeStyle = "rgb(23 22 28 / 0.12)";
  ctx.lineWidth = 1;
  ctx.strokeRect(m + 0.5, m + 0.5, size - 1, size - 1);

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
