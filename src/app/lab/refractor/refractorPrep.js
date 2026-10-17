import { chromeMask } from "./refractorMask";

const MASK_WIDTH = 320;

function pixelsOf(image, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, 0, 0, width, height);
  return ctx.getImageData(0, 0, width, height).data;
}

function fontOf(box, fallback) {
  const family = getComputedStyle(box).fontFamily;
  return family || fallback;
}

function drawBack(card, aspect, box) {
  const width = 640;
  const height = Math.round(width / aspect);
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const sans = fontOf(box, "system-ui, sans-serif");
  const serif = '"Iowan Old Style", "Times New Roman", Georgia, serif';
  const stock = ctx.createLinearGradient(0, 0, width, height);
  stock.addColorStop(0, "#e9e4d8");
  stock.addColorStop(0.35, "#e4dfd2");
  stock.addColorStop(0.7, "#dfd9cb");
  stock.addColorStop(1, "#d9d2c3");
  ctx.fillStyle = stock;
  ctx.fillRect(0, 0, width, height);
  const fibre = ctx.getImageData(0, 0, width, height);
  let seed = card.key.length * 9301 + 49297;
  const rand = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  for (let k = 0; k < fibre.data.length; k += 4) {
    const v = (rand() - 0.5) * 10;
    fibre.data[k] += v;
    fibre.data[k + 1] += v;
    fibre.data[k + 2] += v * 0.9;
  }
  ctx.putImageData(fibre, 0, 0);
  const ink = "#25231f";
  const accent = "#8d2a1f";
  const m = width * 0.07;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 2;
  ctx.strokeRect(m, m, width - m * 2, height - m * 2);
  ctx.lineWidth = 1;
  ctx.strokeRect(m + 8, m + 8, width - m * 2 - 16, height - m * 2 - 16);
  const left = m + 40;
  ctx.fillStyle = ink;
  ctx.textBaseline = "alphabetic";
  ctx.font = `500 22px ${sans}`;
  ctx.fillText("1909 Series", left, m + 70);
  ctx.textAlign = "right";
  ctx.fillText("No. 0217 / 0499", width - left, m + 70);
  ctx.textAlign = "left";
  ctx.font = `italic 400 76px ${serif}`;
  const [first, ...rest] = card.full.split(",")[0].split(" ");
  ctx.fillText(first, left, height * 0.36);
  ctx.fillText(rest.join(" "), left, height * 0.36 + 82);
  ctx.fillStyle = accent;
  ctx.fillRect(left, height * 0.36 + 120, 64, 4);
  ctx.fillStyle = ink;
  ctx.font = `500 28px ${sans}`;
  const rows = [
    ["Club", card.club],
    ["Position", card.position],
    ["Born", card.born],
  ];
  rows.forEach(([label, value], i) => {
    const y = height * 0.36 + 190 + i * 52;
    ctx.fillText(label, left, y);
    ctx.textAlign = "right";
    ctx.fillText(value, width - left, y);
    ctx.textAlign = "left";
    ctx.fillRect(left, y + 16, width - left * 2, 1);
  });
  ctx.font = `italic 400 30px ${serif}`;
  ctx.textAlign = "center";
  ctx.fillText("Refractor", width / 2, height - m - 64);
  ctx.textAlign = "left";
  return canvas;
}

export function prepareCard(card, image, box) {
  const aspect = image.naturalWidth / image.naturalHeight;
  const width = MASK_WIDTH;
  const height = Math.round(width / aspect);
  const pixels = pixelsOf(image, width, height);
  const mask = chromeMask(pixels, width, height);
  return {
    aspect,
    mask: { data: mask.data, width, height },
    art: mask.art,
    paper: mask.paper,
    back: drawBack(card, aspect, box),
  };
}
