function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function coverFace(img, size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, size, size);
  return canvas;
}

function wrap(ctx, text, width) {
  const words = text.split(" ");
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > width) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function setType(ctx, family, weight, px) {
  ctx.font = `${weight} ${px}px ${family}`;
  ctx.letterSpacing = px >= 20 ? `${(-0.043 * (px - 12)).toFixed(2)}px` : "0px";
}

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rampTable(stops) {
  const rgb = stops.map(hexRgb);
  const table = new Uint8ClampedArray(256 * 3);
  for (let i = 0; i < 256; i += 1) {
    const t = i / 255;
    const eased = t * t * (3 - 2 * t) * 0.35 + t * 0.65;
    const f = eased * (rgb.length - 1);
    const k = Math.min(rgb.length - 2, Math.floor(f));
    const w = f - k;
    for (let c = 0; c < 3; c += 1) table[i * 3 + c] = rgb[k][c] + (rgb[k + 1][c] - rgb[k][c]) * w;
  }
  return table;
}

function graded(img, size, look) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const side = Math.min(iw, ih) / look.zoom;
  const sx = Math.min(iw - side, Math.max(0, iw * look.focus[0] - side / 2));
  const sy = Math.min(ih - side, Math.max(0, ih * look.focus[1] - side / 2));
  ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
  const data = ctx.getImageData(0, 0, size, size);
  const px = data.data;
  const table = rampTable(look.ramp);
  let lo = 255;
  let hi = 0;
  for (let k = 0; k < px.length; k += 16) {
    const l = px[k] * 0.3 + px[k + 1] * 0.59 + px[k + 2] * 0.11;
    if (l < lo) lo = l;
    if (l > hi) hi = l;
  }
  const span = Math.max(32, hi - lo);
  for (let k = 0; k < px.length; k += 4) {
    const l = px[k] * 0.3 + px[k + 1] * 0.59 + px[k + 2] * 0.11;
    const v = Math.max(0, Math.min(255, Math.round(((l - lo) / span) * 255)));
    px[k] = table[v * 3];
    px[k + 1] = table[v * 3 + 1];
    px[k + 2] = table[v * 3 + 2];
  }
  ctx.putImageData(data, 0, 0);
  return canvas;
}

function variantFace(card, img, size, family) {
  const { look } = card;
  const canvas = graded(img, size, look);
  const ctx = canvas.getContext("2d");
  const u = size / 640;
  const pad = 40 * u;
  const width = size - pad * 2;
  let px = (look.max || 132) * u;
  let lines = [];
  for (; px > 44 * u; px -= 4 * u) {
    setType(ctx, family, 600, px);
    lines = wrap(ctx, card.song, width);
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (widest <= width && lines.length <= (look.lines || 2)) break;
  }
  const lead = px * 0.94;
  const meta = 24 * u;
  const block = lines.length * lead + meta * 1.9;
  ctx.textBaseline = "alphabetic";
  if (look.plate) {
    const plate = look.plateColor || (look.ink === look.ramp[0] ? look.ramp[look.ramp.length - 1] : look.ramp[0]);
    ctx.fillStyle = plate;
    const top = look.place === "top" ? 0 : size - block - pad * 1.7;
    const h = block + pad * 1.7;
    ctx.fillRect(0, top, size, h);
  }
  ctx.fillStyle = look.ink;
  const firstBase = look.place === "top" ? pad + meta + meta * 0.9 + px * 0.74 : size - pad - (lines.length - 1) * lead - px * 0.04;
  const metaBase = firstBase - px * 0.74 - meta * 0.9;
  setType(ctx, family, 560, meta);
  ctx.fillText(card.side, pad, metaBase);
  setType(ctx, family, 600, px);
  lines.forEach((line, i) => ctx.fillText(line, pad - px * 0.03, firstBase + i * lead));
  return canvas;
}

export async function cardLayers(card, size, family) {
  const [img] = await Promise.all([
    loadImage(card.album.cover),
    document.fonts ? Promise.all([document.fonts.load(`600 120px ${family}`), document.fonts.load(`560 28px ${family}`)]).catch(() => null) : null,
  ]);
  const front = coverFace(img, size);
  const back = variantFace(card, img, size, family);
  return [front, back];
}
