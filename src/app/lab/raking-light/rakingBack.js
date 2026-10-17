const SERIF = "Georgia, 'Times New Roman', 'Liberation Serif', serif";
const SCRIPT = "'Snell Roundhand', 'Segoe Script', 'Brush Script MT', Georgia, 'Times New Roman', serif";

function seeded(seed) {
  let s = Math.floor(seed * 9973) % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

function fitText(ctx, text, weight, size, family, maxWidth, spacing) {
  let px = size;
  for (let i = 0; i < 12; i += 1) {
    ctx.font = `${weight} ${px}px ${family}`;
    ctx.letterSpacing = `${(spacing * px).toFixed(2)}px`;
    if (ctx.measureText(text).width <= maxWidth) break;
    px *= 0.94;
  }
  return px;
}

function line(ctx, text, y, { weight = "normal", size, family = SERIF, style = "", maxWidth, spacing = 0 }) {
  const px = fitText(ctx, text, `${style} ${weight}`.trim(), size, family, maxWidth, spacing);
  ctx.font = `${`${style} ${weight}`.trim()} ${px}px ${family}`;
  ctx.letterSpacing = `${(spacing * px).toFixed(2)}px`;
  ctx.fillText(text, ctx.canvas.width / 2, y);
}

function rule(ctx, y, half, thick) {
  const cx = ctx.canvas.width / 2;
  ctx.fillRect(cx - half, y - thick / 2, half * 2, thick);
}

function loss(ctx, rand, [cx, cy, rw, rh]) {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  ctx.fillStyle = "rgb(0 0 255 / 0.5)";
  for (let i = 0; i < 260; i += 1) {
    const a = rand() * Math.PI * 2;
    const r = Math.sqrt(rand());
    const x = (cx + Math.cos(a) * r * rw) * w;
    const y = (cy + Math.sin(a) * r * rh) * h;
    const size = (0.012 + rand() * 0.035) * w * (1.15 - r * 0.6);
    ctx.beginPath();
    ctx.ellipse(x, y, size, size * (0.6 + rand() * 0.5), rand() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
}

function pencil(ctx, rand, text, x, y, size, tilt) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(tilt);
  ctx.font = `italic ${size}px ${SCRIPT}`;
  ctx.letterSpacing = "0px";
  ctx.textAlign = "left";
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (let pass = 0; pass < 3; pass += 1) {
    ctx.strokeStyle = `rgb(0 ${150 + pass * 40} 0 / ${0.55 + rand() * 0.2})`;
    ctx.lineWidth = size * (0.05 + pass * 0.012);
    ctx.strokeText(text, (rand() - 0.5) * 1.6, (rand() - 0.5) * 1.6);
  }
  ctx.restore();
}

export function drawBack(card, width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  const rand = seeded(card.seed);
  ctx.fillStyle = "rgb(0 0 0)";
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "lighter";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const back = card.back;
  const u = width / 660;

  if (back.kind === "ad") {
    ctx.fillStyle = "rgb(255 0 0)";
    ctx.strokeStyle = "rgb(255 0 0)";
    ctx.lineWidth = 6 * u;
    ctx.strokeRect(40 * u, 40 * u, width - 80 * u, height - 80 * u);
    ctx.lineWidth = 2 * u;
    ctx.strokeRect(54 * u, 54 * u, width - 108 * u, height - 108 * u);
    const inner = width - 150 * u;
    line(ctx, "THE", height * 0.15, { weight: "bold", size: 34 * u, maxWidth: inner, spacing: 0.3 });
    line(ctx, back.brand, height * 0.25, { weight: "bold", size: 104 * u, maxWidth: inner, spacing: 0.04 });
    line(ctx, back.line, height * 0.315, { weight: "bold", size: 50 * u, maxWidth: inner * 0.8, spacing: 0.22 });
    line(ctx, back.motto, height * 0.385, { style: "italic", size: 38 * u, maxWidth: inner, spacing: 0 });
    rule(ctx, height * 0.43, 140 * u, 4 * u);
    rule(ctx, height * 0.44, 90 * u, 2 * u);
    line(ctx, back.series, height * 0.53, { weight: "bold", size: 52 * u, maxWidth: inner, spacing: 0.1 });
    line(ctx, back.count, height * 0.6, { weight: "bold", size: 66 * u, maxWidth: inner, spacing: 0.08 });
    rule(ctx, height * 0.66, 90 * u, 2 * u);
    rule(ctx, height * 0.67, 140 * u, 4 * u);
    line(ctx, back.factory, height * 0.8, { size: 30 * u, maxWidth: inner, spacing: 0.06 });
    if (back.pencil) pencil(ctx, rand, back.pencil, width * 0.52, height * 0.905, 54 * u, -0.06);
  } else {
    pencil(ctx, rand, back.pencil, width * 0.16, height * 0.46, 76 * u, -0.08);
    pencil(ctx, rand, back.pencil2, width * 0.5, height * 0.6, 92 * u, -0.05);
  }

  for (const patch of back.loss || []) loss(ctx, rand, patch);
  return canvas;
}
