import { chromeMask } from "./refractorMask";

const MASK_WIDTH = 320;
const CARD_W = 660;
const CARD_H = 924;
const SERIF = '"Iowan Old Style", "Times New Roman", Georgia, serif';
const INK = "#24221e";
const ACCENT = "#8d2a1f";

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

function stock(ctx, width, height, seedText, tone) {
  const fill = ctx.createLinearGradient(0, 0, width, height);
  tone.forEach((c, i) => fill.addColorStop(i / (tone.length - 1), c));
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, width, height);
  const fibre = ctx.getImageData(0, 0, width, height);
  let seed = [...seedText].reduce((s, ch) => s + ch.charCodeAt(0), 0) * 9301 + 49297;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let k = 0; k < fibre.data.length; k += 4) {
    const v = (rand() - 0.5) * 8;
    fibre.data[k] += v;
    fibre.data[k + 1] += v;
    fibre.data[k + 2] += v * 0.9;
  }
  ctx.putImageData(fibre, 0, 0);
}

function fitLines(ctx, text, maxWidth, sizes, family, style) {
  for (const size of sizes) {
    ctx.font = `${style} ${size}px ${family}`;
    if (ctx.measureText(text).width <= maxWidth) return { size, lines: [text] };
  }
  const size = sizes[sizes.length - 1];
  ctx.font = `${style} ${size}px ${family}`;
  const words = text.split(" ");
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
  return { size, lines: lines.slice(0, 2) };
}

function coverCrop(image) {
  const w = image.naturalWidth || image.width;
  const h = image.naturalHeight || image.height;
  const side = Math.min(w, h);
  return [(w - side) / 2, (h - side) / 2, side, side];
}

function drawFront(card, image, box) {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  const sans = fontOf(box);
  stock(ctx, CARD_W, CARD_H, card.key, ["#efebe2", "#ebe6dc", "#e7e1d6", "#e3ddd0"]);
  const m = 36;
  const side = CARD_W - m * 2;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, ...coverCrop(image), m, m, side, side);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3;
  ctx.strokeRect(m - 1.5, m - 1.5, side + 3, side + 3);
  const left = m + 4;
  const right = CARD_W - m - 4;
  ctx.fillStyle = INK;
  ctx.textBaseline = "alphabetic";
  const title = fitLines(ctx, card.title, right - left, [56, 50, 44, 40], SERIF, "italic 400");
  const top = m + side + 20 + title.size;
  title.lines.forEach((line, i) => ctx.fillText(line, left, top + i * title.size * 1.04));
  const after = top + (title.lines.length - 1) * title.size * 1.04;
  ctx.font = `500 26px ${sans}`;
  ctx.fillText(card.artist, left, after + 44);
  if (card.year) {
    ctx.textAlign = "right";
    ctx.fillText(String(card.year), right, after + 44);
    ctx.textAlign = "left";
  }
  ctx.fillStyle = ACCENT;
  ctx.fillRect(left, CARD_H - m - 50, 56, 4);
  ctx.fillStyle = INK;
  ctx.font = `500 22px ${sans}`;
  ctx.textAlign = "right";
  ctx.fillText(`${String(card.number).padStart(2, "0")} / ${String(card.count).padStart(2, "0")}`, right, CARD_H - m - 22);
  ctx.textAlign = "left";
  ctx.font = `italic 400 30px ${SERIF}`;
  ctx.fillText("Refractor", left, CARD_H - m - 18);
  return canvas;
}

function drawBack(card, box) {
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext("2d");
  const sans = fontOf(box);
  stock(ctx, CARD_W, CARD_H, `${card.key}-back`, ["#e9e4d8", "#e4dfd2", "#dfd9cb", "#d9d2c3"]);
  const m = CARD_W * 0.07;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.strokeRect(m, m, CARD_W - m * 2, CARD_H - m * 2);
  ctx.lineWidth = 1;
  ctx.strokeRect(m + 8, m + 8, CARD_W - m * 2 - 16, CARD_H - m * 2 - 16);
  const left = m + 36;
  const right = CARD_W - left;
  ctx.fillStyle = INK;
  ctx.textBaseline = "alphabetic";
  ctx.font = `500 22px ${sans}`;
  ctx.fillText(card.artist, left, m + 66);
  if (card.year) {
    ctx.textAlign = "right";
    ctx.fillText(String(card.year), right, m + 66);
    ctx.textAlign = "left";
  }
  const title = fitLines(ctx, card.title, right - left, [64, 56, 48, 42], SERIF, "italic 400");
  const top = m + 120 + title.size * 0.6;
  title.lines.forEach((line, i) => ctx.fillText(line, left, top + i * title.size * 1.04));
  const ruleY = top + (title.lines.length - 1) * title.size * 1.04 + 36;
  ctx.fillStyle = ACCENT;
  ctx.fillRect(left, ruleY, 64, 4);
  ctx.fillStyle = INK;
  ctx.font = `500 25px ${sans}`;
  const rows = card.tracks.slice(0, 7);
  rows.forEach((name, i) => {
    const y = ruleY + 72 + i * 50;
    ctx.textAlign = "left";
    ctx.fillText(String(i + 1).padStart(2, "0"), left, y);
    let label = name;
    while (ctx.measureText(label).width > right - left - 60 && label.length > 4) label = `${label.slice(0, -2)}…`;
    ctx.fillText(label, left + 52, y);
    ctx.fillRect(left, y + 16, right - left, 1);
  });
  ctx.font = `italic 400 30px ${SERIF}`;
  ctx.textAlign = "center";
  ctx.fillText("Refractor", CARD_W / 2, CARD_H - m - 52);
  ctx.textAlign = "left";
  return canvas;
}

export function prepareCard(card, image, box) {
  const front = drawFront(card, image, box);
  const aspect = CARD_W / CARD_H;
  const width = MASK_WIDTH;
  const height = Math.round(width / aspect);
  const pixels = pixelsOf(front, width, height);
  const inset = 36 / CARD_W;
  const artBox = [inset, 36 / CARD_H, 1 - inset, (CARD_W - 36) / CARD_H];
  const mask = chromeMask(pixels, width, height, { artBox });
  return {
    aspect,
    front,
    mask: { data: mask.data, width, height },
    art: mask.art,
    paper: mask.paper,
    back: drawBack(card, box),
  };
}
