const SIZE = 1024;

function track(px) {
  return `${(-0.043 * (px - 12)).toFixed(2)}px`;
}

function arcText(ctx, text, radius, center, font, px, bottom) {
  ctx.save();
  ctx.font = font;
  if ("letterSpacing" in ctx) ctx.letterSpacing = track(px);
  const chars = [...text];
  const widths = chars.map((ch) => ctx.measureText(ch).width);
  const span = widths.reduce((a, b) => a + b, 0) / radius;
  let angle = bottom ? center + span / 2 : center - span / 2;
  ctx.textAlign = "center";
  chars.forEach((ch, i) => {
    const step = widths[i] / radius;
    const mid = bottom ? angle - step / 2 : angle + step / 2;
    ctx.save();
    ctx.rotate(mid);
    ctx.translate(0, bottom ? radius : -radius);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
    angle = bottom ? angle - step : angle + step;
  });
  ctx.restore();
}

export async function drawLabel(record, fonts) {
  const img = new Image();
  img.decoding = "async";
  img.src = record.cover;
  await img.decode();
  if (document.fonts?.ready) await document.fonts.ready.catch(() => {});
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  const c = SIZE / 2;
  ctx.fillStyle = "rgb(12 12 12)";
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.translate(c, c);

  ctx.fillStyle = "rgb(241 238 230)";
  ctx.beginPath();
  ctx.arc(0, 0, c, 0, Math.PI * 2);
  ctx.fill();

  const inner = c * 0.7;
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, inner, 0, Math.PI * 2);
  ctx.clip();
  const scale = Math.max((inner * 2) / img.naturalWidth, (inner * 2) / img.naturalHeight) * 1.04;
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  ctx.filter = "grayscale(1) contrast(1.08) brightness(1.04)";
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  ctx.filter = "none";
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = "rgb(248 244 236)";
  ctx.fillRect(-inner, -inner, inner * 2, inner * 2);
  ctx.globalCompositeOperation = "source-over";
  ctx.restore();

  ctx.strokeStyle = "rgb(20 20 20)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, inner, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, c * 0.965, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "rgb(20 20 20)";
  ctx.textBaseline = "middle";
  const ring = (inner + c * 0.965) / 2;
  arcText(ctx, record.title, ring, 0, `italic 430 64px ${fonts.serif}`, 64, false);
  arcText(ctx, "Side one  ·  33⅓", ring, 0, `440 34px ${fonts.mono}`, 34, true);
  arcText(ctx, String(record.year), ring, Math.PI * 0.5, `440 26px ${fonts.mono}`, 26, false);
  arcText(ctx, record.artist, ring, -Math.PI * 0.5, `540 28px ${fonts.sans}`, 28, false);

  ctx.fillStyle = "rgb(8 8 8)";
  ctx.beginPath();
  ctx.arc(0, 0, SIZE * 0.036, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}
