export const THREADS = {
  redwork: { dark: "rgb(104, 14, 22)", body: "rgb(176, 28, 38)", core: "rgb(206, 52, 56)", light: "rgba(255, 190, 176, 1)", ply: "rgba(70, 6, 12, 0.5)", rgb: [176, 28, 38] },
  bluework: { dark: "rgb(16, 26, 70)", body: "rgb(36, 60, 138)", core: "rgb(60, 90, 172)", light: "rgba(196, 214, 255, 1)", ply: "rgba(8, 14, 44, 0.5)", rgb: [36, 60, 138] },
  blackwork: { dark: "rgb(10, 10, 12)", body: "rgb(34, 33, 37)", core: "rgb(58, 56, 62)", light: "rgba(214, 214, 224, 1)", ply: "rgba(0, 0, 0, 0.55)", rgb: [34, 33, 37] },
};

const LX = -0.55;
const LY = -0.835;

function polyline(xs, ys, a, b, extraX, extraY, smooth) {
  const path = new Path2D();
  if (smooth && b - a >= 2) {
    path.moveTo((xs[a] + xs[a + 1]) / 2, (ys[a] + ys[a + 1]) / 2);
    for (let i = a + 1; i < b; i += 1) path.quadraticCurveTo(xs[i], ys[i], (xs[i] + xs[i + 1]) / 2, (ys[i] + ys[i + 1]) / 2);
    return path;
  }
  path.moveTo(xs[a], ys[a]);
  for (let i = a + 1; i <= b; i += 1) path.lineTo(xs[i], ys[i]);
  if (extraX !== undefined) path.lineTo(extraX, extraY);
  return path;
}

export function strokeThread(ctx, xs, ys, a, b, w, palette, options = {}) {
  const { holes = false, lift = 0, tailX, tailY, smooth = false, from = 0 } = options;
  if (b - a < 1 && tailX === undefined) return;
  const path = polyline(xs, ys, a, b, tailX, tailY, smooth);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  ctx.save();
  ctx.translate(w * (0.25 + lift * 1.4), w * (0.6 + lift * 2.6));
  ctx.strokeStyle = `rgba(58, 36, 16, ${0.08 + lift * 0.02})`;
  ctx.lineWidth = w * (2 + lift * 1.2);
  ctx.stroke(path);
  ctx.restore();

  ctx.save();
  ctx.translate(w * (0.16 + lift * 0.5), w * (0.36 + lift * 1));
  ctx.strokeStyle = `rgba(48, 26, 10, ${0.3 - lift * 0.1})`;
  ctx.lineWidth = w * 1.12;
  ctx.stroke(path);
  ctx.restore();

  ctx.strokeStyle = palette.body;
  ctx.lineWidth = w;
  ctx.stroke(path);

  const spec = new Path2D();
  const ply = new Path2D();
  const shade = new Path2D();
  const groove = shade;
  const count = tailX === undefined ? b : b + 1;
  for (let i = Math.min(a + from, count); i < count; i += 1) {
    const x0 = xs[i];
    const y0 = ys[i];
    const x1 = i + 1 <= b ? xs[i + 1] : tailX;
    const y1 = i + 1 <= b ? ys[i + 1] : tailY;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const len = Math.hypot(dx, dy);
    if (len < 0.01) continue;
    const ux = dx / len;
    const uy = dy / len;
    let nx = -uy;
    let ny = ux;
    if (nx * LX + ny * LY < 0) {
      nx = -nx;
      ny = -ny;
    }
    const t0 = holes ? 0.18 : 0;
    const t1 = holes ? 0.82 : 1;
    shade.moveTo(x0 + dx * t0 - nx * w * 0.3, y0 + dy * t0 - ny * w * 0.3);
    shade.lineTo(x0 + dx * t1 - nx * w * 0.3, y0 + dy * t1 - ny * w * 0.3);
    if (len > w * 1.6) {
      spec.moveTo(x0 + dx * 0.3 + nx * w * 0.2, y0 + dy * 0.3 + ny * w * 0.2);
      spec.lineTo(x0 + dx * 0.7 + nx * w * 0.2, y0 + dy * 0.7 + ny * w * 0.2);
    }
    const pitch = w * 1.05;
    const twists = Math.max(1, Math.round(len / pitch));
    const span = len / twists;
    const sx = ux * w * 0.3;
    const sy = uy * w * 0.3;
    const ax = -uy * w * 0.4;
    const ay = ux * w * 0.4;
    for (let s = 0; s < twists; s += 1) {
      const along = span * (s + 0.5);
      const cx = x0 + ux * along;
      const cy = y0 + uy * along;
      ply.moveTo(cx - sx - ax, cy - sy - ay);
      ply.lineTo(cx + sx + ax, cy + sy + ay);
      const gx = cx + ux * span * 0.5;
      const gy = cy + uy * span * 0.5;
      if (s < twists - 1 || !holes) {
        groove.moveTo(gx - sx - ax, gy - sy - ay);
        groove.lineTo(gx + sx + ax, gy + sy + ay);
      }
    }
  }
  ctx.strokeStyle = palette.dark;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = w * 0.3;
  ctx.lineCap = "butt";
  ctx.stroke(shade);
  ctx.strokeStyle = palette.light;
  ctx.globalAlpha = 0.34;
  ctx.lineWidth = w * 0.3;
  ctx.stroke(ply);
  ctx.lineCap = "round";
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = w * 0.2;
  ctx.stroke(spec);
  ctx.globalAlpha = 1;

  if (holes) {
    const pinch = new Path2D();
    const r = w * 0.3;
    for (let i = a; i <= b; i += 1) {
      pinch.moveTo(xs[i] + r, ys[i]);
      pinch.arc(xs[i], ys[i], r, 0, Math.PI * 2);
    }
    ctx.fillStyle = palette.dark;
    ctx.globalAlpha = 0.6;
    ctx.fill(pinch);
    ctx.globalAlpha = 1;
  }
}

export function drawNeedle(ctx, x, y, ux, uy, length, w, palette, tucked = 0) {
  const nx = -uy;
  const ny = ux;
  const eyeBack = length * 0.06;
  const bx = x - ux * eyeBack;
  const by = y - uy * eyeBack;
  const tipX = bx + ux * length;
  const tipY = by + uy * length;
  const half = Math.max(1.3, w * 1.0);

  const outline = new Path2D();
  outline.moveTo(bx + nx * half * 0.8, by + ny * half * 0.8);
  outline.quadraticCurveTo(bx - ux * half * 1.1, by - uy * half * 1.1, bx - nx * half * 0.8, by - ny * half * 0.8);
  outline.lineTo(bx + ux * length * 0.72 - nx * half, by + uy * length * 0.72 - ny * half);
  outline.quadraticCurveTo(bx + ux * length * 0.9 - nx * half * 0.5, by + uy * length * 0.9 - ny * half * 0.5, tipX, tipY);
  outline.quadraticCurveTo(bx + ux * length * 0.9 + nx * half * 0.5, by + uy * length * 0.9 + ny * half * 0.5, bx + ux * length * 0.72 + nx * half, by + uy * length * 0.72 + ny * half);
  outline.closePath();

  const dive = tucked >= 0.5;
  ctx.save();
  if (dive) {
    const band = new Path2D();
    band.rect(x - length * 3, y - length * 3, length * 6, length * 6);
    const b0 = 0.5;
    const b1 = 0.64;
    const spread = half * 5;
    band.moveTo(bx + ux * length * b0 + nx * spread, by + uy * length * b0 + ny * spread);
    band.lineTo(bx + ux * length * b1 + nx * spread, by + uy * length * b1 + ny * spread);
    band.lineTo(bx + ux * length * b1 - nx * spread, by + uy * length * b1 - ny * spread);
    band.lineTo(bx + ux * length * b0 - nx * spread, by + uy * length * b0 - ny * spread);
    band.closePath();
    ctx.clip(band, "evenodd");
  }
  ctx.save();
  ctx.translate(w * (dive ? 0.3 : 0.5), w * (dive ? 0.7 : 1.6));
  ctx.fillStyle = `rgba(40, 28, 16, ${dive ? 0.28 : 0.18})`;
  ctx.fill(outline);
  ctx.restore();

  const steel = ctx.createLinearGradient(bx - nx * half, by - ny * half, bx + nx * half, by + ny * half);
  steel.addColorStop(0, "rgb(92, 96, 104)");
  steel.addColorStop(0.3, "rgb(150, 156, 166)");
  steel.addColorStop(0.55, "rgb(236, 240, 246)");
  steel.addColorStop(0.75, "rgb(170, 176, 186)");
  steel.addColorStop(1, "rgb(96, 100, 110)");
  ctx.fillStyle = steel;
  ctx.fill(outline);
  ctx.strokeStyle = "rgba(60, 62, 70, 0.55)";
  ctx.lineWidth = Math.max(0.4, w * 0.14);
  ctx.stroke(outline);

  const eyeLen = length * 0.1;
  const eyeX = bx + ux * length * 0.04;
  const eyeY = by + uy * length * 0.04;
  ctx.strokeStyle = "rgba(40, 40, 46, 0.85)";
  ctx.lineCap = "round";
  ctx.lineWidth = Math.max(0.5, half * 0.6);
  ctx.beginPath();
  ctx.moveTo(eyeX, eyeY);
  ctx.lineTo(eyeX + ux * eyeLen, eyeY + uy * eyeLen);
  ctx.stroke();

  const glint = new Path2D();
  glint.moveTo(bx + ux * length * 0.2 + nx * half * 0.25, by + uy * length * 0.2 + ny * half * 0.25);
  glint.lineTo(bx + ux * length * 0.68 + nx * half * 0.25, by + uy * length * 0.68 + ny * half * 0.25);
  ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
  ctx.lineWidth = Math.max(0.4, half * 0.32);
  ctx.stroke(glint);
  ctx.restore();
  if (dive) {
    ctx.fillStyle = "rgba(60, 40, 20, 0.35)";
    for (const t of [0.5, 0.64]) {
      ctx.beginPath();
      ctx.ellipse(bx + ux * length * t, by + uy * length * t, half * 1.5, half * 0.7, Math.atan2(uy, ux) + Math.PI / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const tailLen = length * 0.22;
  const loop = new Path2D();
  loop.moveTo(eyeX + ux * eyeLen * 0.5, eyeY + uy * eyeLen * 0.5);
  loop.quadraticCurveTo(eyeX + ux * eyeLen * 0.5 + nx * w * 2.2, eyeY + uy * eyeLen * 0.5 + ny * w * 2.2, eyeX + ux * (eyeLen + tailLen) + nx * w * 1.6, eyeY + uy * (eyeLen + tailLen) + ny * w * 1.6);
  ctx.strokeStyle = palette.dark;
  ctx.lineWidth = w;
  ctx.stroke(loop);
  ctx.strokeStyle = palette.body;
  ctx.lineWidth = w * 0.65;
  ctx.stroke(loop);
}
