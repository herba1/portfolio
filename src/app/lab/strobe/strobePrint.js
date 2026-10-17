const PX_MM = 6;
const RECT = [168, 70, 266, 214];
const XF = 214;
const ZF0 = 140;
const HT = 50;

function track(px) {
  return `${(-0.043 * (px - 12)).toFixed(2)}px`;
}

function setFont(ctx, font, px) {
  ctx.font = font;
  if ("letterSpacing" in ctx) ctx.letterSpacing = track(px);
}

function arcText(ctx, text, radius, center, font, px, bottom) {
  ctx.save();
  setFont(ctx, font, px);
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

export async function drawPrint(fonts) {
  if (document.fonts?.ready) await document.fonts.ready.catch(() => {});
  const w = (RECT[2] - RECT[0]) * PX_MM;
  const h = (RECT[3] - RECT[1]) * PX_MM;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = "rgb(255 255 255)";
  ctx.strokeStyle = "rgb(255 255 255)";
  const X = (mm) => (mm - RECT[0]) * PX_MM;
  const Z = (mm) => (mm - RECT[1]) * PX_MM;

  for (let i = -8; i <= 8; i++) {
    const z = ZF0 - (i / 8) * HT;
    const major = i % 2 === 0;
    ctx.lineWidth = i === 0 ? 0.7 * PX_MM : 0.4 * PX_MM;
    ctx.beginPath();
    ctx.moveTo(X(XF + 7), Z(z));
    ctx.lineTo(X(XF + (i === 0 ? 15 : major ? 12 : 10)), Z(z));
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(X(XF - 7), Z(z));
    ctx.lineTo(X(XF - (i === 0 ? 12 : major ? 10 : 9)), Z(z));
    ctx.stroke();
    if (major) {
      const label = i === 0 ? "0" : i > 0 ? `−${i}` : `+${-i}`;
      const px = 3.4 * PX_MM;
      setFont(ctx, `540 ${px}px ${fonts.mono}`, px);
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(label, X(XF + 17), Z(z));
    }
  }

  const small = 3.0 * PX_MM;
  setFont(ctx, `520 ${small}px ${fonts.sans}`, small);
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("lock", X(192), Z(ZF0 + 8));
  ctx.save();
  ctx.translate(X(XF + 31), Z(ZF0));
  ctx.rotate(-Math.PI / 2);
  setFont(ctx, `520 ${small}px ${fonts.sans}`, small);
  ctx.fillText("pitch adjust  %", 0, 0);
  ctx.restore();

  return canvas;
}

export async function drawLabel(fonts) {
  if (document.fonts?.ready) await document.fonts.ready.catch(() => {});
  const SIZE = 1024;
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  const c = SIZE / 2;
  ctx.fillStyle = "rgb(16 14 12)";
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.translate(c, c);
  const grad = ctx.createRadialGradient(0, 0, c * 0.1, 0, 0, c);
  grad.addColorStop(0, "rgb(214 72 34)");
  grad.addColorStop(0.55, "rgb(204 64 30)");
  grad.addColorStop(0.85, "rgb(190 58 28)");
  grad.addColorStop(1, "rgb(176 52 26)");
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, c, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = "rgb(246 236 220)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(0, 0, c * 0.94, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(0, 0, c * 0.9, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "rgb(246 236 220)";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const title = 104;
  setFont(ctx, `italic 430 ${title}px ${fonts.serif}`, title);
  ctx.fillText("Friday Beat", 0, -c * 0.42);
  const meta = 34;
  setFont(ctx, `540 ${meta}px ${fonts.mono}`, meta);
  ctx.fillText("Side A", -c * 0.52, 0);
  ctx.fillText("33⅓", c * 0.52, 0);
  const sub = 30;
  setFont(ctx, `450 ${sub}px ${fonts.sans}`, sub);
  ctx.fillText("Monovolt Records", 0, c * 0.42);
  ctx.textBaseline = "middle";
  arcText(ctx, "Str 033  ·  Stereo  ·  Made under strobe light", c * 0.8, Math.PI, `440 26px ${fonts.mono}`, 26, true);

  ctx.fillStyle = "rgb(10 9 8)";
  ctx.beginPath();
  ctx.arc(0, 0, SIZE * 0.036, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}
