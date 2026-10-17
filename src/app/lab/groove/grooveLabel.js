const CELL = 512;

function arcText(ctx, text, radius, center, size, weight, family, color, below) {
  ctx.save();
  ctx.font = `${weight} ${size}px ${family}`;
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width + size * 0.04);
  const total = widths.reduce((a, b) => a + b, 0);
  let angle = center - (below ? -1 : 1) * (total / radius) / 2;
  chars.forEach((c, i) => {
    const w = widths[i];
    const step = w / radius;
    const mid = angle + (below ? -1 : 1) * step / 2;
    ctx.save();
    ctx.translate(CELL / 2 + Math.cos(mid) * radius, CELL / 2 + Math.sin(mid) * radius);
    ctx.rotate(mid + (below ? -Math.PI / 2 : Math.PI / 2));
    ctx.fillText(c, 0, 0);
    ctx.restore();
    angle += (below ? -1 : 1) * step;
  });
  ctx.restore();
}

function speckle(ctx, seed) {
  let s = seed;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  ctx.save();
  for (let i = 0; i < 900; i += 1) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * CELL * 0.5;
    ctx.globalAlpha = 0.03 + rand() * 0.05;
    ctx.fillStyle = rand() > 0.5 ? "#000" : "#fff";
    ctx.fillRect(CELL / 2 + Math.cos(a) * r, CELL / 2 + Math.sin(a) * r, 1 + rand() * 1.5, 1);
  }
  ctx.restore();
}

function drawOne(ctx, preset, family, index) {
  ctx.save();
  ctx.translate(index * CELL, 0);
  ctx.fillStyle = preset.paper;
  ctx.fillRect(0, 0, CELL, CELL);
  speckle(ctx, 77 + index * 13);

  ctx.strokeStyle = preset.ink;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(CELL / 2, CELL / 2, CELL * 0.465, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(CELL / 2, CELL / 2, CELL * 0.452, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  arcText(ctx, "Pictures pressed into the groove · play under one light", CELL * 0.41, -Math.PI / 2, 15, 500, family, preset.ink, false);
  arcText(ctx, `${preset.catalog} · Herb Records · 33⅓ rpm · Stereo`, CELL * 0.41, Math.PI / 2, 14, 500, family, preset.ink, true);

  ctx.fillStyle = preset.ink;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.font = `600 64px ${family}`;
  ctx.fillText("Groove", CELL / 2, CELL * 0.35);

  ctx.font = `500 18px ${family}`;
  ctx.fillText(preset.side, CELL / 2, CELL * 0.235);

  ctx.fillStyle = preset.accent;
  ctx.beginPath();
  ctx.arc(CELL * 0.18, CELL / 2, 9, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(CELL * 0.82, CELL / 2, 9, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = preset.ink;
  ctx.font = `600 24px ${family}`;
  ctx.fillText(preset.track, CELL / 2, CELL * 0.655);
  ctx.font = `500 17px ${family}`;
  ctx.fillText(`1.  ${preset.time}`, CELL / 2, CELL * 0.71);
  ctx.font = `italic 400 17px Georgia, "Times New Roman", serif`;
  ctx.fillText("an etched picture disc", CELL / 2, CELL * 0.775);
  ctx.restore();
}

export function buildLabels(presets) {
  const canvas = document.createElement("canvas");
  canvas.width = CELL * presets.length;
  canvas.height = CELL;
  const ctx = canvas.getContext("2d");
  const family = getComputedStyle(document.body).fontFamily || "system-ui, sans-serif";
  presets.forEach((preset, i) => drawOne(ctx, preset, family, i));
  return canvas;
}
