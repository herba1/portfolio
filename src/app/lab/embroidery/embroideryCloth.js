const LINEN = [221, 210, 188];
const LINEN_GAP = [176, 162, 136];

function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function noise1(x) {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return hash(i) * (1 - u) + hash(i + 1) * u;
}

function noise2(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);
  const a = hash(ix + iy * 57);
  const b = hash(ix + 1 + iy * 57);
  const c = hash(ix + (iy + 1) * 57);
  const d = hash(ix + 1 + (iy + 1) * 57);
  return (a * (1 - ux) + b * ux) * (1 - uy) + (c * (1 - ux) + d * ux) * uy;
}

export function makeCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

export function paintLinen(ctx, size, radius, dpr) {
  const image = ctx.createImageData(size, size);
  const data = image.data;
  const period = 2.7 * dpr;
  const centre = size / 2;
  const r2 = (radius + 2) * (radius + 2);
  for (let y = 0; y < size; y += 1) {
    const dy = y + 0.5 - centre;
    for (let x = 0; x < size; x += 1) {
      const dx = x + 0.5 - centre;
      if (dx * dx + dy * dy > r2) continue;
      const u = x / period + (noise1(y / period * 0.07 + 3.1) - 0.5) * 0.5;
      const v = y / period + (noise1(x / period * 0.07 + 9.7) - 0.5) * 0.5;
      const i = Math.floor(u);
      const j = Math.floor(v);
      const fu = u - i;
      const fv = v - j;
      const warpWidth = 0.7 + 0.26 * noise1(i * 3.71 + v * 0.045) + 0.12 * (hash(i * 1.3) - 0.5);
      const weftWidth = 0.68 + 0.28 * noise1(j * 5.13 + u * 0.05 + 40) + 0.12 * (hash(j * 2.1 + 7) - 0.5);
      const du = Math.abs(fu - 0.5) / (warpWidth / 2);
      const dv = Math.abs(fv - 0.5) / (weftWidth / 2);
      const warpTop = ((i + j) & 1) === 0;
      let shade;
      let tone;
      let gap = 0;
      if (du < 1 && (warpTop || dv >= 1)) {
        const across = Math.sqrt(1 - du * du);
        const along = warpTop ? 0.82 + 0.18 * Math.sin(Math.PI * fv) : 0.7;
        shade = across * along;
        tone = 0.94 + 0.12 * hash(i * 0.917 + 5);
      } else if (dv < 1) {
        const across = Math.sqrt(1 - dv * dv);
        const along = !warpTop ? 0.82 + 0.18 * Math.sin(Math.PI * fu) : 0.7;
        shade = across * along;
        tone = 0.95 + 0.1 * hash(j * 1.733 + 11);
      } else {
        shade = 0;
        tone = 1;
        gap = 1;
      }
      const mottle = 0.965 + 0.07 * noise2(x / (period * 9), y / (period * 9));
      const lift = (0.86 + 0.17 * shade) * tone * mottle;
      const index = (y * size + x) * 4;
      if (gap) {
        data[index] = LINEN_GAP[0] * mottle;
        data[index + 1] = LINEN_GAP[1] * mottle;
        data[index + 2] = LINEN_GAP[2] * mottle;
      } else {
        data[index] = Math.min(255, LINEN[0] * lift);
        data[index + 1] = Math.min(255, LINEN[1] * lift);
        data[index + 2] = Math.min(255, LINEN[2] * lift * 0.99);
      }
      data[index + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
}

function grain(ctx, cx, cy, inner, outer, seed, alpha) {
  const lines = Math.round((outer - inner) * 2.2);
  for (let l = 0; l < lines; l += 1) {
    const t = (l + hash(seed + l) * 0.8) / lines;
    const base = inner + (outer - inner) * t;
    const dark = hash(seed * 3 + l) > 0.5;
    ctx.strokeStyle = dark ? `rgba(120, 72, 30, ${alpha * (0.4 + hash(l + 9) * 0.6)})` : `rgba(255, 236, 200, ${alpha * 0.7 * hash(l + 4)})`;
    ctx.lineWidth = 0.4 + hash(l + seed) * 0.8;
    ctx.beginPath();
    const steps = 180;
    for (let s = 0; s <= steps; s += 1) {
      const a = (s / steps) * Math.PI * 2;
      const wobble = (noise1(a * 6 + l * 1.7 + seed) - 0.5) * (outer - inner) * 0.22;
      const r = Math.max(inner, Math.min(outer, base + wobble));
      const px = cx + Math.cos(a) * r;
      const py = cy + Math.sin(a) * r;
      if (s === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
}

function woodRing(ctx, cx, cy, inner, outer, seed) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, outer, 0, Math.PI * 2);
  ctx.arc(cx, cy, inner, 0, Math.PI * 2, true);
  ctx.closePath();
  ctx.clip();
  const band = ctx.createRadialGradient(cx, cy, inner, cx, cy, outer);
  band.addColorStop(0, "rgb(150, 98, 52)");
  band.addColorStop(0.12, "rgb(190, 136, 82)");
  band.addColorStop(0.38, "rgb(222, 176, 118)");
  band.addColorStop(0.55, "rgb(228, 186, 128)");
  band.addColorStop(0.78, "rgb(206, 154, 96)");
  band.addColorStop(0.94, "rgb(168, 112, 60)");
  band.addColorStop(1, "rgb(124, 78, 38)");
  ctx.fillStyle = band;
  ctx.fillRect(cx - outer, cy - outer, outer * 2, outer * 2);
  grain(ctx, cx, cy, inner, outer, seed, 0.22);
  const light = ctx.createLinearGradient(cx - outer * 0.7, cy - outer * 0.7, cx + outer * 0.7, cy + outer * 0.7);
  light.addColorStop(0, "rgba(255, 246, 226, 0.32)");
  light.addColorStop(0.3, "rgba(255, 246, 226, 0.1)");
  light.addColorStop(0.55, "rgba(0, 0, 0, 0)");
  light.addColorStop(0.8, "rgba(70, 38, 10, 0.12)");
  light.addColorStop(1, "rgba(70, 38, 10, 0.24)");
  ctx.fillStyle = light;
  ctx.fillRect(cx - outer, cy - outer, outer * 2, outer * 2);
  ctx.restore();
}

export function paintHoopBase(ctx, g) {
  const { cx, cy, outer } = g;
  ctx.save();
  ctx.fillStyle = "rgba(0, 0, 0, 1)";
  ctx.shadowColor = "rgba(60, 40, 20, 0.16)";
  ctx.shadowBlur = outer * 0.12;
  ctx.shadowOffsetY = outer * 0.06;
  ctx.shadowOffsetX = outer * 0.02;
  ctx.beginPath();
  ctx.arc(cx, cy, outer, 0, Math.PI * 2);
  ctx.globalCompositeOperation = "source-over";
  ctx.fill();
  ctx.shadowColor = "rgba(60, 40, 20, 0.12)";
  ctx.shadowBlur = outer * 0.02;
  ctx.shadowOffsetY = outer * 0.01;
  ctx.fill();
  ctx.restore();
}

export function paintRing(ctx, g) {
  const { cx, cy, linen, inner, outer, ring } = g;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, linen, 0, Math.PI * 2);
  ctx.clip();
  const ao = ctx.createRadialGradient(cx, cy, linen * 0.82, cx, cy, linen);
  ao.addColorStop(0, "rgba(80, 56, 30, 0)");
  ao.addColorStop(0.55, "rgba(80, 56, 30, 0.035)");
  ao.addColorStop(0.85, "rgba(80, 56, 30, 0.1)");
  ao.addColorStop(1, "rgba(70, 46, 20, 0.22)");
  ctx.fillStyle = ao;
  ctx.fillRect(cx - linen, cy - linen, linen * 2, linen * 2);
  const sheen = ctx.createLinearGradient(cx - linen, cy - linen, cx + linen, cy + linen);
  sheen.addColorStop(0, "rgba(255, 250, 238, 0.12)");
  sheen.addColorStop(0.45, "rgba(255, 250, 238, 0)");
  sheen.addColorStop(1, "rgba(60, 40, 20, 0.06)");
  ctx.fillStyle = sheen;
  ctx.fillRect(cx - linen, cy - linen, linen * 2, linen * 2);
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, inner, 0, Math.PI * 2);
  ctx.arc(cx, cy, linen, 0, Math.PI * 2, true);
  ctx.closePath();
  ctx.clip();
  const fold = ctx.createRadialGradient(cx, cy, linen, cx, cy, inner);
  fold.addColorStop(0, "rgb(170, 154, 128)");
  fold.addColorStop(0.35, "rgb(222, 211, 190)");
  fold.addColorStop(0.7, "rgb(232, 222, 202)");
  fold.addColorStop(1, "rgb(176, 160, 132)");
  ctx.fillStyle = fold;
  ctx.fillRect(cx - inner, cy - inner, inner * 2, inner * 2);
  ctx.restore();

  ctx.save();
  ctx.shadowColor = "rgba(70, 44, 18, 0.28)";
  ctx.shadowBlur = ring * 0.5;
  ctx.shadowOffsetY = ring * 0.18;
  ctx.beginPath();
  ctx.arc(cx, cy, outer, 0, Math.PI * 2);
  ctx.arc(cx, cy, inner, 0, Math.PI * 2, true);
  ctx.fillStyle = "rgb(200, 150, 96)";
  ctx.fill("evenodd");
  ctx.restore();
  woodRing(ctx, cx, cy, inner, outer, 17);

  const lugW = ring * 1.05;
  const lugH = ring * 1.5;
  const top = cy - outer - lugH * 0.62;
  const gap = ring * 0.28;
  for (const side of [-1, 1]) {
    const x = cx + side * (gap / 2) + (side < 0 ? -lugW : 0);
    ctx.save();
    ctx.shadowColor = "rgba(70, 44, 18, 0.3)";
    ctx.shadowBlur = ring * 0.4;
    ctx.shadowOffsetY = ring * 0.15;
    const block = ctx.createLinearGradient(x, 0, x + lugW, 0);
    block.addColorStop(0, side < 0 ? "rgb(214, 166, 108)" : "rgb(196, 144, 88)");
    block.addColorStop(0.5, side < 0 ? "rgb(226, 182, 124)" : "rgb(208, 158, 100)");
    block.addColorStop(1, side < 0 ? "rgb(184, 132, 78)" : "rgb(170, 118, 66)");
    ctx.fillStyle = block;
    ctx.beginPath();
    ctx.roundRect(x, top, lugW, lugH, ring * 0.16);
    ctx.fill();
    ctx.restore();
    const shade = ctx.createLinearGradient(0, top, 0, top + lugH);
    shade.addColorStop(0, "rgba(255, 240, 210, 0.22)");
    shade.addColorStop(0.3, "rgba(255, 240, 210, 0)");
    shade.addColorStop(1, "rgba(80, 48, 18, 0.18)");
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.roundRect(x, top, lugW, lugH, ring * 0.16);
    ctx.fill();
  }
  const boltY = top + lugH * 0.42;
  const boltR = ring * 0.2;
  const bolt = ctx.createLinearGradient(0, boltY - boltR, 0, boltY + boltR);
  bolt.addColorStop(0, "rgb(120, 98, 58)");
  bolt.addColorStop(0.25, "rgb(244, 224, 160)");
  bolt.addColorStop(0.45, "rgb(206, 170, 96)");
  bolt.addColorStop(0.8, "rgb(140, 108, 52)");
  bolt.addColorStop(1, "rgb(96, 72, 34)");
  ctx.fillStyle = bolt;
  ctx.beginPath();
  ctx.roundRect(cx - lugW - gap / 2 - ring * 0.5, boltY - boltR, lugW * 2 + gap + ring * 0.9, boltR * 2, boltR);
  ctx.fill();
  const headX = cx + lugW + gap / 2 + ring * 0.42;
  const head = ctx.createRadialGradient(headX - ring * 0.12, boltY - ring * 0.14, ring * 0.04, headX, boltY, ring * 0.46);
  head.addColorStop(0, "rgb(255, 244, 200)");
  head.addColorStop(0.35, "rgb(222, 188, 112)");
  head.addColorStop(0.8, "rgb(150, 116, 56)");
  head.addColorStop(1, "rgb(100, 76, 36)");
  ctx.save();
  ctx.shadowColor = "rgba(60, 40, 10, 0.35)";
  ctx.shadowBlur = ring * 0.3;
  ctx.shadowOffsetY = ring * 0.12;
  ctx.fillStyle = head;
  ctx.beginPath();
  ctx.ellipse(headX, boltY, ring * 0.3, ring * 0.44, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = "rgba(90, 64, 26, 0.6)";
  ctx.lineWidth = Math.max(0.6, ring * 0.06);
  ctx.beginPath();
  ctx.moveTo(headX, boltY - ring * 0.3);
  ctx.lineTo(headX, boltY + ring * 0.3);
  ctx.stroke();
}
