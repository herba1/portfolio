import { chromeMask } from "./refractorMask";

const MASK_WIDTH = 320;
const CARD_W = 660;
const CARD_H = 924;
const K = 1.25;
const SERIF = '"Iowan Old Style", "Times New Roman", Georgia, serif';
const FOIL = "#ffffff";
const SILVER = "#e9e8e6";
const BORDER = 22;
const SEAM = CARD_W - BORDER;
const PANEL_TOP = SEAM + 8;
const PANEL_BOTTOM = CARD_H - BORDER;

function canvasOf(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(w * K);
  canvas.height = Math.round(h * K);
  const ctx = canvas.getContext("2d");
  ctx.scale(K, K);
  ctx.imageSmoothingQuality = "high";
  return { canvas, ctx };
}

function pixelsOf(source, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

function fontOf(box) {
  return getComputedStyle(box).fontFamily || "system-ui, sans-serif";
}

function coverCrop(image) {
  const w = image.naturalWidth || image.width;
  const h = image.naturalHeight || image.height;
  const side = Math.min(w, h);
  return [(w - side) / 2, (h - side) / 2, side, side];
}

function hsl(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h / 6, s, l];
}

function teamColour(image) {
  const n = 28;
  const data = pixelsOf(image, n, n);
  const bins = new Float32Array(24);
  const sat = new Float32Array(24);
  for (let k = 0; k < data.length; k += 4) {
    const [h, s, l] = hsl(data[k] / 255, data[k + 1] / 255, data[k + 2] / 255);
    if (s < 0.22 || l < 0.12 || l > 0.86) continue;
    const bin = Math.floor(h * 24) % 24;
    const w = s * (1 - Math.abs(l - 0.5));
    bins[bin] += w;
    sat[bin] += s * w;
  }
  let best = -1;
  let score = 0;
  for (let i = 0; i < 24; i += 1) {
    const v = bins[(i + 23) % 24] * 0.5 + bins[i] + bins[(i + 1) % 24] * 0.5;
    if (v > score) {
      score = v;
      best = i;
    }
  }
  if (best < 0 || score < (n * n) / 60) return { h: 30, s: 6, deep: "hsl(30 6% 9%)", mid: "hsl(30 4% 30%)", wash: "hsl(30 8% 88%)" };
  const h = Math.round(((best + 0.5) / 24) * 360);
  const s = Math.round(Math.min(0.62, Math.max(0.3, sat[best] / Math.max(bins[best], 1e-4))) * 100);
  return { h, s, deep: `hsl(${h} ${s}% 15%)`, mid: `hsl(${h} ${Math.round(s * 0.8)}% 34%)`, wash: `hsl(${h} ${Math.round(s * 0.6)}% 86%)` };
}

function lineFit(ctx, text, maxWidth, sizes, weight, family, maxLines = 2) {
  for (const size of sizes) {
    ctx.font = `${weight} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) return { size, lines: [text] };
  }
  for (const size of sizes) {
    ctx.font = `${weight} ${size}px ${family}`;
    const words = String(text).split(" ");
    const lines = [];
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (ctx.measureText(next).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = next;
    }
    if (line) lines.push(line);
    if (lines.length <= maxLines && lines.every((l) => ctx.measureText(l).width <= maxWidth)) return { size, lines };
  }
  const size = sizes[sizes.length - 1];
  ctx.font = `${weight} ${size}px ${family}`;
  return { size, lines: [clip(ctx, text, maxWidth)] };
}

function clip(ctx, text, maxWidth) {
  let out = String(text);
  if (ctx.measureText(out).width <= maxWidth) return out;
  while (out.length > 2 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
}

function track(ctx, size) {
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${(-0.043 * (size - 12) * 0.5).toFixed(2)}px`;
}

function untrack(ctx) {
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
}

function roundRect(ctx, x, y, w, h, r) {
  const [tl, tr, br, bl] = Array.isArray(r) ? r : [r, r, r, r];
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.arcTo(x + w, y, x + w, y + h, tr);
  ctx.arcTo(x + w, y + h, x, y + h, br);
  ctx.arcTo(x, y + h, x, y, bl);
  ctx.arcTo(x, y, x + w, y, tl);
  ctx.closePath();
}

function setMark(ctx, cx, cy, r, colour, year, sans) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r + 7, 0, Math.PI * 2);
  ctx.fillStyle = SILVER;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fillStyle = "#121212";
  ctx.fill();
  ctx.strokeStyle = FOIL;
  for (let i = 0; i < 2; i += 1) {
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r - 7 - i * 6, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r * 0.6, 0, Math.PI * 2);
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.fillStyle = FOIL;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 28px ${sans}`;
  track(ctx, 28);
  ctx.fillText(year ? `’${String(year).slice(-2)}` : "LP", cx, cy + 2);
  untrack(ctx);
  ctx.restore();
}

function drawFront(card, image, box, team) {
  const { canvas, ctx } = canvasOf(CARD_W, CARD_H);
  const sans = fontOf(box);
  ctx.fillStyle = SILVER;
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  ctx.save();
  ctx.translate(CARD_W / 2, CARD_H * 0.42);
  for (let i = 0; i < 72; i += 1) {
    ctx.rotate((Math.PI * 2) / 72);
    ctx.fillStyle = i % 2 ? "#dcdbd8" : "#f1f0ee";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-30, -900);
    ctx.lineTo(30, -900);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();

  const x0 = BORDER;
  const x1 = CARD_W - BORDER;
  roundRect(ctx, x0 - 2, BORDER - 2, x1 - x0 + 4, PANEL_BOTTOM - BORDER + 4, 10);
  ctx.fillStyle = "#0e0e0e";
  ctx.fill();
  ctx.save();
  roundRect(ctx, x0, BORDER, x1 - x0, SEAM - BORDER, [8, 8, 0, 0]);
  ctx.clip();
  ctx.drawImage(image, ...coverCrop(image), x0, BORDER, x1 - x0, SEAM - BORDER);
  ctx.restore();

  ctx.fillStyle = SILVER;
  ctx.fillRect(x0, SEAM, x1 - x0, PANEL_TOP - SEAM);
  roundRect(ctx, x0, PANEL_TOP, x1 - x0, PANEL_BOTTOM - PANEL_TOP, [0, 0, 8, 8]);
  ctx.fillStyle = team.deep;
  ctx.fill();

  const left = x0 + 34;
  const markR = 54;
  const markX = x1 - 30 - markR;
  const markY = SEAM + 4;
  const right = x1 - 34;
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = FOIL;

  const titleRoom = right - left;
  const title = lineFit(ctx, card.title, titleRoom, [62, 56, 50, 46], 700, sans, 1);
  const longTitle = title.lines[0] !== card.title || title.size < 46;
  const fitted = longTitle ? lineFit(ctx, card.title, titleRoom, [46, 42, 38, 34], 700, sans, 2) : title;
  const lead = Math.round(fitted.size * 1.02);
  const block = (fitted.lines.length - 1) * lead;
  const ruleY = PANEL_TOP + 160;
  const titleBase = ruleY - 32;

  ctx.font = `600 24px ${sans}`;
  track(ctx, 24);
  ctx.fillText(clip(ctx, card.artist, markX - markR - 24 - left), left, titleBase - Math.round(fitted.size * 0.78) - block - 18);
  ctx.font = `700 ${fitted.size}px ${sans}`;
  track(ctx, fitted.size);
  fitted.lines.forEach((line, i) => ctx.fillText(line, left, titleBase - block + i * lead));
  untrack(ctx);

  ctx.fillRect(left, ruleY, right - left, 2);
  ctx.font = `600 22px ${sans}`;
  track(ctx, 22);
  ctx.fillText(card.year ? String(card.year) : "Long play", left, PANEL_BOTTOM - 38);
  untrack(ctx);
  ctx.textAlign = "right";
  ctx.font = `italic 400 26px ${SERIF}`;
  ctx.fillText("Refractor", right, PANEL_BOTTOM - 37);
  ctx.textAlign = "left";

  setMark(ctx, markX, markY, markR, team.mid, card.year, sans);
  return canvas;
}

function stock(ctx, w, h, seedText) {
  ctx.fillStyle = "#e4e1da";
  ctx.fillRect(0, 0, w, h);
  let seed = [...seedText].reduce((s, ch) => s + ch.charCodeAt(0), 0) * 9301 + 49297;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let i = 0; i < 2600; i += 1) {
    ctx.fillStyle = rand() > 0.5 ? "rgb(255 255 255 / 0.22)" : "rgb(90 80 60 / 0.12)";
    const x = rand() * w;
    const y = rand() * h;
    ctx.fillRect(x, y, 1 + rand() * 3, 1);
  }
}

function drawBack(card, box, team) {
  const { canvas, ctx } = canvasOf(CARD_W, CARD_H);
  const sans = fontOf(box);
  const ink = "#1a1917";
  stock(ctx, CARD_W, CARD_H, `${card.key}-back`);
  const m = 30;
  const w = CARD_W - m * 2;

  roundRect(ctx, m, m, w, 172, 12);
  ctx.fillStyle = team.deep;
  ctx.fill();
  roundRect(ctx, m + 20, m + 20, 132, 132, 8);
  ctx.fillStyle = "#f6f4ef";
  ctx.fill();
  ctx.fillStyle = team.deep;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `600 20px ${sans}`;
  ctx.fillText("No.", m + 86, m + 62);
  ctx.font = `700 64px ${sans}`;
  track(ctx, 64);
  ctx.fillText(String(card.number).padStart(2, "0"), m + 86, m + 128);
  untrack(ctx);

  const tl = m + 176;
  const tr = m + w - 24;
  ctx.textAlign = "left";
  ctx.fillStyle = "#f6f4ef";
  const title = lineFit(ctx, card.title, tr - tl, [40, 36, 32, 28], 700, sans, 2);
  const lead = Math.round(title.size * 1.08);
  ctx.font = `700 ${title.size}px ${sans}`;
  track(ctx, title.size);
  const titleTop = m + 86 - ((title.lines.length - 1) * lead) / 2;
  title.lines.forEach((line, i) => ctx.fillText(line, tl, titleTop + i * lead));
  untrack(ctx);
  ctx.font = `500 22px ${sans}`;
  ctx.fillText(clip(ctx, card.artist, tr - tl), tl, titleTop + (title.lines.length - 1) * lead + 40);

  ctx.fillStyle = ink;
  const listTop = m + 172 + 52;
  ctx.font = `600 22px ${sans}`;
  ctx.fillText("Tracklist", m + 4, listTop);
  ctx.textAlign = "right";
  ctx.font = `500 20px ${sans}`;
  ctx.fillText("Side one", m + w - 4, listTop);
  ctx.textAlign = "left";
  const rows = card.tracks.slice(0, 8);
  const rowH = 50;
  rows.forEach((name, i) => {
    const y = listTop + 20 + i * rowH;
    if (i % 2 === 0) {
      roundRect(ctx, m, y, w, rowH, 6);
      ctx.fillStyle = team.wash;
      ctx.fill();
    }
    ctx.fillStyle = ink;
    ctx.font = `600 20px ${sans}`;
    ctx.fillText(String(i + 1).padStart(2, "0"), m + 16, y + 32);
    ctx.font = `500 22px ${sans}`;
    ctx.fillText(clip(ctx, name, w - 80), m + 60, y + 32);
  });

  const statsTop = CARD_H - m - 176;
  ctx.fillStyle = ink;
  ctx.fillRect(m, statsTop, w, 3);
  const cells = [
    ["Released", card.year ? String(card.year) : "—"],
    ["Tracks", String(card.tracks.length || "—")],
    ["Card", `${String(card.number).padStart(2, "0")} of ${String(card.count).padStart(2, "0")}`],
  ];
  const cw = w / cells.length;
  cells.forEach(([label, value], i) => {
    const x = m + cw * i;
    if (i) ctx.fillRect(x, statsTop + 20, 1, 84);
    ctx.textAlign = "left";
    ctx.font = `500 20px ${sans}`;
    ctx.fillText(label, x + (i ? 20 : 4), statsTop + 46);
    ctx.font = `700 36px ${sans}`;
    track(ctx, 36);
    ctx.fillText(value, x + (i ? 20 : 4), statsTop + 92);
    untrack(ctx);
  });
  ctx.fillRect(m, statsTop + 120, w, 1);
  ctx.textAlign = "center";
  ctx.font = `italic 400 26px ${SERIF}`;
  ctx.fillText("Refractor", CARD_W / 2, CARD_H - m - 14);
  ctx.textAlign = "left";
  return canvas;
}

export function prepareCard(card, image, box) {
  const team = teamColour(image);
  const front = drawFront(card, image, box, team);
  const aspect = CARD_W / CARD_H;
  const width = MASK_WIDTH;
  const height = Math.round(width / aspect);
  const pixels = pixelsOf(front, width, height);
  const artBox = [BORDER / CARD_W, BORDER / CARD_H, (CARD_W - BORDER) / CARD_W, SEAM / CARD_H];
  const mask = chromeMask(pixels, width, height, { artBox });
  return {
    aspect,
    front,
    mask: { data: mask.data, width, height },
    art: mask.art,
    paper: mask.paper,
    back: drawBack(card, box, team),
  };
}
