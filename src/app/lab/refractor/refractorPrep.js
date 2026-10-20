const SERIF = '"Iowan Old Style", "Times New Roman", Georgia, serif';

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

const SIZE = 1024;
const C = SIZE / 2;
const PRINT_IN = 0.36;
const PRINT_OUT = 0.975;
const BAND_IN = 0.855;

function annulus(ctx, r0, r1) {
  ctx.beginPath();
  ctx.arc(C, C, r1 * C, 0, Math.PI * 2);
  ctx.arc(C, C, r0 * C, 0, Math.PI * 2, true);
  ctx.closePath();
}

function ringText(ctx, text, radius, start) {
  let a = start;
  ctx.save();
  ctx.translate(C, C);
  for (const ch of text) {
    const w = ctx.measureText(ch).width;
    a += w / 2 / radius;
    ctx.save();
    ctx.rotate(a);
    ctx.fillText(ch, 0, -radius);
    ctx.restore();
    a += w / 2 / radius;
  }
  ctx.restore();
  return a;
}

function fitRing(ctx, parts, radius, span) {
  const room = radius * span;
  const out = [];
  let used = 0;
  for (const part of parts) {
    const w = ctx.measureText(part).width;
    if (used + w > room) break;
    out.push(part);
    used += w;
  }
  return out.join("");
}

function drawLabel(card, image, box, team) {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  const sans = fontOf(box);
  ctx.save();
  annulus(ctx, PRINT_IN, PRINT_OUT);
  ctx.clip();
  const iw = image.naturalWidth || image.width;
  const ih = image.naturalHeight || image.height;
  const side = Math.min(iw, ih);
  const span = PRINT_OUT * C * 2;
  ctx.drawImage(image, (iw - side) / 2, (ih - side) / 2, side, side, C - span / 2, C - span / 2, span, span);
  annulus(ctx, BAND_IN, PRINT_OUT);
  ctx.fillStyle = team.deep;
  ctx.fill();
  ctx.fillStyle = "#f6f3ec";
  annulus(ctx, BAND_IN - 0.006, BAND_IN);
  ctx.fill();
  annulus(ctx, PRINT_IN, PRINT_IN + 0.03);
  ctx.fill();
  ctx.restore();

  const radius = ((BAND_IN + PRINT_OUT) / 2) * C;
  ctx.fillStyle = "#f6f3ec";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `600 27px ${sans}`;
  const head = `${card.title}`;
  const end = ringText(ctx, head, radius, -Math.PI * 0.32);
  ctx.font = `500 22px ${sans}`;
  const meta = `  ·  ${card.artist}${card.year ? `  ·  ${card.year}` : ""}`;
  const after = ringText(ctx, meta, radius, end);
  const tracks = card.tracks.map((name, i) => `     ${i + 1}  ${name}`);
  const room = Math.PI * 2 - 0.08 - (after - -Math.PI * 0.32);
  const list = fitRing(ctx, tracks, radius, room);
  if (list) ringText(ctx, list, radius, after);
  return canvas;
}

export function prepareCard(card, image, box) {
  const team = teamColour(image);
  const seed = [...card.key].reduce((s, ch) => s + ch.charCodeAt(0), 0);
  return {
    aspect: 1,
    label: drawLabel(card, image, box, team),
    data: 0.5 + ((seed * 37) % 100) / 300,
  };
}
