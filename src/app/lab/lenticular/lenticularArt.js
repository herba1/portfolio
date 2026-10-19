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

function songFace(card, size, family) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const u = size / 640;
  const pad = 44 * u;
  ctx.fillStyle = card.paper;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = card.ink;
  ctx.textBaseline = "alphabetic";

  const meta = 28 * u;
  setType(ctx, family, 560, meta);
  ctx.fillText(card.album.artist, pad, pad + meta);
  setType(ctx, family, 440, meta);
  ctx.fillText(`${card.album.title}, ${card.album.year}`, pad, pad + meta * 2.2);
  ctx.textAlign = "right";
  setType(ctx, family, 440, meta);
  ctx.fillText(card.side, size - pad, pad + meta);
  ctx.textAlign = "left";

  const width = size - pad * 2;
  const room = size - pad * 2 - meta * 4;
  let px = 168 * u;
  let lines = [];
  for (; px > 48 * u; px -= 4 * u) {
    setType(ctx, family, 600, px);
    lines = wrap(ctx, card.song, width);
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (widest <= width && lines.length * px * 0.92 <= room) break;
  }
  const lead = px * 0.92;
  const base = size - pad - px * 0.2;
  lines.forEach((line, i) => {
    ctx.fillText(line, pad - px * 0.04, base - (lines.length - 1 - i) * lead);
  });
  return canvas;
}

export async function cardLayers(card, size, family) {
  const [img] = await Promise.all([
    loadImage(card.album.cover),
    document.fonts ? Promise.all([document.fonts.load(`600 120px ${family}`), document.fonts.load(`440 28px ${family}`)]).catch(() => null) : null,
  ]);
  const front = coverFace(img, size);
  const back = songFace(card, size, family);
  return [front, back];
}
