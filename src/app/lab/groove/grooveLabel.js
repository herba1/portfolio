const CELL = 512;

function arcText(ctx, text, radius, center, size, weight, family, color, below) {
  ctx.save();
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width + size * 0.02);
  const total = widths.reduce((a, b) => a + b, 0);
  let angle = center - ((below ? -1 : 1) * (total / radius)) / 2;
  chars.forEach((c, i) => {
    const step = widths[i] / radius;
    const mid = angle + ((below ? -1 : 1) * step) / 2;
    ctx.save();
    ctx.translate(CELL / 2 + Math.cos(mid) * radius, CELL / 2 + Math.sin(mid) * radius);
    ctx.rotate(mid + (below ? -Math.PI / 2 : Math.PI / 2));
    ctx.fillText(c, 0, 0);
    ctx.restore();
    angle += (below ? -1 : 1) * step;
  });
  ctx.restore();
}

function fitTracks(ctx, tracks, maxWidth, size, family) {
  ctx.font = `500 ${size}px ${family}`;
  let line = "";
  for (const name of tracks) {
    const next = line ? `${line}  ·  ${name}` : name;
    if (ctx.measureText(next).width > maxWidth) break;
    line = next;
  }
  return line;
}

function speckle(ctx, seed) {
  let s = seed;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  ctx.save();
  for (let i = 0; i < 700; i += 1) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * CELL * 0.5;
    ctx.globalAlpha = 0.03 + rand() * 0.04;
    ctx.fillStyle = rand() > 0.5 ? "#000" : "#fff";
    ctx.fillRect(CELL / 2 + Math.cos(a) * r, CELL / 2 + Math.sin(a) * r, 1 + rand() * 1.5, 1);
  }
  ctx.restore();
}

function drawOne(ctx, preset, image, family, index) {
  const c = CELL / 2;
  const inner = CELL * 0.33;
  ctx.save();
  ctx.translate(index * CELL, 0);
  ctx.fillStyle = preset.paper;
  ctx.fillRect(0, 0, CELL, CELL);
  if (image) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, inner, 0, Math.PI * 2);
    ctx.clip();
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    ctx.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, c - inner, c - inner, inner * 2, inner * 2);
    ctx.restore();
  }
  speckle(ctx, 77 + index * 13);
  ctx.strokeStyle = preset.ink;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(c, c, inner + 1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(c, c, CELL * 0.475, 0, Math.PI * 2);
  ctx.stroke();
  const ring = CELL * 0.405;
  arcText(ctx, `${preset.title}  ·  ${preset.artist}  ·  ${preset.year}`, ring, -Math.PI / 2, 21, 600, family, preset.ink, false);
  const tracks = fitTracks(ctx, preset.tracks, ring * Math.PI * 0.86, 15, family);
  arcText(ctx, tracks, ring, Math.PI / 2, 15, 500, family, preset.ink, true);
  ctx.fillStyle = preset.ink;
  ctx.font = `500 13px ${family}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.save();
  ctx.translate(c - ring, c);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText("Side one", 0, 0);
  ctx.restore();
  ctx.save();
  ctx.translate(c + ring, c);
  ctx.rotate(Math.PI / 2);
  ctx.fillText("33⅓ rpm", 0, 0);
  ctx.restore();
  ctx.restore();
}

export function buildLabels(presets, images = []) {
  const canvas = document.createElement("canvas");
  canvas.width = CELL * presets.length;
  canvas.height = CELL;
  const ctx = canvas.getContext("2d");
  const family = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
  presets.forEach((preset, i) => drawOne(ctx, preset, images[i], family, i));
  return canvas;
}
