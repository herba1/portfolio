import { measureText, strokeText } from "./scoreboardGlyphs";

export function makeRng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeFbm(rand, octaves = 4) {
  const size = 64;
  const tables = [];
  for (let o = 0; o < octaves; o += 1) {
    const g = new Float32Array(size * size);
    for (let i = 0; i < g.length; i += 1) g[i] = rand();
    tables.push(g);
  }
  const sample = (g, x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const fx = x - xi;
    const fy = y - yi;
    const x0 = ((xi % size) + size) % size;
    const y0 = ((yi % size) + size) % size;
    const x1 = (x0 + 1) % size;
    const y1 = (y0 + 1) % size;
    const u = fx * fx * (3 - 2 * fx);
    const v = fy * fy * (3 - 2 * fy);
    const a = g[y0 * size + x0];
    const b = g[y0 * size + x1];
    const c = g[y1 * size + x0];
    const d = g[y1 * size + x1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  return (x, y) => {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o += 1) {
      sum += sample(tables[o], x * freq + o * 17.3, y * freq + o * 9.1) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return sum / norm;
  };
}

export function canvas(w, h) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

function field(w, h, fn) {
  const c = canvas(w, h);
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(c.width, c.height);
  const d = img.data;
  for (let y = 0; y < c.height; y += 1) {
    for (let x = 0; x < c.width; x += 1) {
      const i = (y * c.width + x) * 4;
      const v = fn(x / c.width, y / c.height);
      d[i] = v[0];
      d[i + 1] = v[1];
      d[i + 2] = v[2];
      d[i + 3] = v[3];
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function smooth(a, b, x) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

function grainTile(rand, size = 128) {
  const c = canvas(size, size);
  const ctx = c.getContext("2d");
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i += 1) {
    const v = 128 + (rand() - 0.5) * 120;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

function chips(ctx, w, h, rand, count, min, max, edgeBias = 0) {
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  for (let i = 0; i < count; i += 1) {
    let x = rand() * w;
    let y = rand() * h;
    if (edgeBias && rand() < edgeBias) {
      const side = Math.floor(rand() * 4);
      if (side === 0) x = rand() * min * 2;
      if (side === 1) x = w - rand() * min * 2;
      if (side === 2) y = rand() * min * 2;
      if (side === 3) y = h - rand() * min * 2;
    }
    const r = min + Math.pow(rand(), 2.4) * (max - min);
    const n = 5 + Math.floor(rand() * 4);
    ctx.beginPath();
    for (let k = 0; k < n; k += 1) {
      const a = (k / n) * Math.PI * 2;
      const rr = r * (0.55 + rand() * 0.7);
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr * (0.6 + rand() * 0.5);
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.globalAlpha = 0.65 + rand() * 0.35;
    ctx.fill();
  }
  ctx.restore();
}

function speckle(ctx, w, h, rand, count, size, alpha) {
  ctx.save();
  ctx.globalCompositeOperation = "destination-out";
  for (let i = 0; i < count; i += 1) {
    ctx.globalAlpha = alpha * (0.4 + rand() * 0.6);
    const s = size * (0.4 + rand());
    ctx.fillRect(rand() * w, rand() * h, s, s * (0.6 + rand() * 0.8));
  }
  ctx.restore();
}

export function paintedText(text, height, rand, { color = "rgb(240 236 224)", squeeze = 1, wear = 1, scale = 1 } = {}) {
  const pad = Math.ceil(height * 0.3);
  const w = measureText(text, height, squeeze);
  const layer = canvas((w + pad * 2) * scale, (height + pad * 2) * scale);
  const ctx = layer.getContext("2d");
  ctx.scale(scale, scale);
  ctx.strokeStyle = color;
  for (let pass = 0; pass < 3; pass += 1) {
    ctx.globalAlpha = pass === 0 ? 1 : 0.35;
    const ox = pass === 0 ? 0 : (rand() - 0.5) * height * 0.012;
    const oy = pass === 0 ? 0 : (rand() - 0.5) * height * 0.012;
    strokeText(ctx, text, pad + ox, pad + oy, height, {
      squeeze,
      weight: pass === 0 ? 1 : 1.03,
      jitter: () => (rand() - 0.5) * 0.012,
    });
  }
  ctx.globalAlpha = 1;
  const lw = layer.width / scale;
  const lh = layer.height / scale;
  chips(ctx, lw, lh, rand, Math.round(4 * wear * text.length), height * 0.012, height * 0.07);
  speckle(ctx, lw, lh, rand, Math.round(260 * wear * text.length), height * 0.018, 0.55);
  ctx.save();
  ctx.globalCompositeOperation = "source-atop";
  const fade = ctx.createLinearGradient(0, pad, 0, pad + height);
  fade.addColorStop(0, "rgb(255 252 240 / 0.08)");
  fade.addColorStop(0.55, "rgb(255 252 240 / 0)");
  fade.addColorStop(1, "rgb(70 80 60 / 0.16)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, lw, lh);
  ctx.restore();
  return { canvas: layer, pad, width: w, height };
}

export function drawPainted(ctx, painted, x, y) {
  ctx.drawImage(
    painted.canvas,
    x - painted.pad,
    y - painted.pad,
    painted.width + painted.pad * 2,
    painted.height + painted.pad * 2,
  );
}

function rivet(ctx, x, y, r, rand, rusty) {
  const shadow = ctx.createRadialGradient(x + r * 1.6, y + r * 0.7, r * 0.2, x + r * 1.6, y + r * 0.7, r * 2.6);
  shadow.addColorStop(0, "rgb(6 14 10 / 0.5)");
  shadow.addColorStop(0.5, "rgb(6 14 10 / 0.22)");
  shadow.addColorStop(1, "rgb(6 14 10 / 0)");
  ctx.save();
  ctx.translate(x + r * 1.6, y + r * 0.7);
  ctx.scale(1.7, 0.75);
  ctx.translate(-(x + r * 1.6), -(y + r * 0.7));
  ctx.fillStyle = shadow;
  ctx.beginPath();
  ctx.arc(x + r * 1.6, y + r * 0.7, r * 2.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  if (rusty) {
    const halo = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * (2 + rand() * 1.4));
    halo.addColorStop(0, "rgb(120 58 22 / 0.55)");
    halo.addColorStop(1, "rgb(120 58 22 / 0)");
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, r * 3.4, 0, Math.PI * 2);
    ctx.fill();
  }
  const dome = ctx.createRadialGradient(x - r * 0.45, y - r * 0.4, r * 0.05, x, y, r);
  dome.addColorStop(0, rusty ? "rgb(170 120 76)" : "rgb(132 160 132)");
  dome.addColorStop(0.35, rusty ? "rgb(110 66 36)" : "rgb(64 98 74)");
  dome.addColorStop(1, rusty ? "rgb(40 22 12)" : "rgb(16 32 24)");
  ctx.fillStyle = dome;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function rustDrip(ctx, x, y, len, width, rand) {
  const g = ctx.createLinearGradient(0, y, 0, y + len);
  const a = 0.18 + rand() * 0.22;
  g.addColorStop(0, `rgb(128 60 22 / ${a})`);
  g.addColorStop(0.35, `rgb(118 56 24 / ${a * 0.6})`);
  g.addColorStop(0.75, `rgb(104 52 26 / ${a * 0.22})`);
  g.addColorStop(1, "rgb(104 52 26 / 0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(x - width * 0.5, y);
  const wob = width * 0.6;
  ctx.bezierCurveTo(x - width * 0.6 + (rand() - 0.5) * wob, y + len * 0.4, x - width * 0.2, y + len * 0.7, x, y + len);
  ctx.bezierCurveTo(x + width * 0.2, y + len * 0.7, x + width * 0.6 + (rand() - 0.5) * wob, y + len * 0.4, x + width * 0.5, y);
  ctx.closePath();
  ctx.fill();
}

export function lightAt(x, y, W, H) {
  const nx = x / W;
  const ny = y / H;
  const sun = 0.42 + 0.58 * (1 - smooth(-0.15, 1.2, nx * 0.95 + ny * 0.3));
  const roofLine = 0.06 + (nx - 0.58) * 0.95;
  const roof = smooth(-0.012, 0.012, roofLine - ny);
  const poleX = 0.79 - ny * 0.2;
  const pole = 1 - smooth(0.015, 0.019, Math.abs(nx - poleX));
  const shade = Math.max(roof, pole * 0.92);
  const edge = smooth(0.0, 0.18, Math.min(nx, 1 - nx, ny * 1.6, 1 - ny));
  const hx = nx - 0.16;
  const hy = (ny - 0.36) * 1.4;
  const hot = Math.exp(-(hx * hx + hy * hy) * 5);
  const lit = Math.min(1, sun * (0.82 + 0.18 * edge) + hot * 0.12);
  return { lit, shade };
}

export function bakeLight(W, H) {
  const cw = Math.max(32, Math.round(W / 6));
  const ch = Math.max(24, Math.round(H / 6));
  return field(cw, ch, (fx, fy) => {
    const { lit, shade } = lightAt(fx * W, fy * H, W, H);
    const sr = 255 * lit;
    const sg = 218 * lit;
    const sb = 152 * lit;
    const r = sr * (1 - shade) + 44 * shade;
    const g = sg * (1 - shade) + 66 * shade;
    const b = sb * (1 - shade) + 96 * shade;
    return [r, g, b, 255];
  });
}

export function bakeGlow(W, H, dpr) {
  const c = canvas(W * dpr, H * dpr);
  const ctx = c.getContext("2d");
  ctx.scale(dpr, dpr);
  const haze = ctx.createLinearGradient(0, 0, W, H * 0.5);
  haze.addColorStop(0, "rgb(255 168 84 / 0.36)");
  haze.addColorStop(0.25, "rgb(255 150 70 / 0.15)");
  haze.addColorStop(0.55, "rgb(255 140 60 / 0.03)");
  haze.addColorStop(1, "rgb(255 140 60 / 0)");
  ctx.fillStyle = haze;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.translate(-W * 0.05, H * 0.1);
  ctx.rotate(-0.32);
  const shaft = ctx.createLinearGradient(0, -H * 0.18, 0, H * 0.18);
  shaft.addColorStop(0, "rgb(255 196 120 / 0)");
  shaft.addColorStop(0.35, "rgb(255 196 120 / 0.035)");
  shaft.addColorStop(0.5, "rgb(255 200 130 / 0.055)");
  shaft.addColorStop(0.65, "rgb(255 196 120 / 0.035)");
  shaft.addColorStop(1, "rgb(255 196 120 / 0)");
  ctx.fillStyle = shaft;
  ctx.fillRect(0, -H * 0.18, W * 1.4, H * 0.36);
  ctx.restore();
  return c;
}

export function bakeBoard(layout, dpr, seed = 7) {
  const { W, H, u } = layout;
  const rand = makeRng(seed);
  const c = canvas(W * dpr, H * dpr);
  const ctx = c.getContext("2d");
  ctx.scale(dpr, dpr);

  ctx.fillStyle = "rgb(78 120 84)";
  ctx.fillRect(0, 0, W, H);

  const fbm = makeFbm(rand, 5);
  const fbm2 = makeFbm(rand, 4);
  const lw = Math.max(64, Math.round(W / 5));
  const lh = Math.max(48, Math.round(H / 5));
  const sx = W / (u * 1.5);
  const sy = H / (u * 1.5);
  const mottle = field(lw, lh, (fx, fy) => {
    const n = fbm(fx * sx, fy * sy);
    const v = 128 + (n - 0.5) * 120;
    return [v, v, v, 255];
  });
  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  ctx.globalAlpha = 0.6;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(mottle, 0, 0, W, H);
  ctx.restore();

  const streaks = field(48, Math.max(64, Math.round(H / 2.2)), (fx, fy) => {
    const n = fbm2(fx * 3, fy * H / (u * 0.12));
    const v = 128 + (n - 0.5) * 110;
    return [v, v, v, 255];
  });
  ctx.save();
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = 0.32;
  ctx.drawImage(streaks, 0, 0, W, H);
  ctx.restore();

  const chalk = field(lw * 2, lh * 2, (fx, fy) => {
    const n = fbm2(fx * sx * 4 + 40, fy * sy * 4);
    const bias = 0.08 * fy + 0.05 * (1 - fx);
    const m = smooth(0.6, 0.7, n + bias);
    return [196, 208, 186, m * 255];
  });
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.1;
  ctx.drawImage(chalk, 0, 0, W, H);
  ctx.restore();

  for (let i = 0; i < 9; i += 1) {
    const pw = u * (1.5 + rand() * 5);
    const ph = u * (0.8 + rand() * 3);
    const px = rand() * W - pw * 0.3;
    const py = rand() * H - ph * 0.3;
    const dark = rand() < 0.6;
    roughPatch(ctx, px, py, pw, ph, dark ? `rgb(30 58 42 / ${0.12 + rand() * 0.12})` : `rgb(120 150 112 / ${0.04 + rand() * 0.05})`, rand, u);
  }

  drawRepaint(ctx, layout, rand);

  const panelW = u * 4.4;
  const seamStart = layout.ox - panelW * Math.ceil(layout.ox / panelW);
  const seamsX = [];
  for (let x = seamStart; x < W + panelW; x += panelW) seamsX.push(x);
  const seamsY = [layout.oy - u * 0.95, layout.rackTop - u * 0.42];
  for (const x of seamsX) {
    ctx.fillStyle = "rgb(12 24 18 / 0.55)";
    ctx.fillRect(x - 1, 0, 1.4, H);
    ctx.fillStyle = "rgb(150 180 140 / 0.16)";
    ctx.fillRect(x + 0.6, 0, 1, H);
  }
  for (const y of seamsY) {
    ctx.fillStyle = "rgb(12 24 18 / 0.5)";
    ctx.fillRect(0, y - 1, W, 1.4);
    ctx.fillStyle = "rgb(150 180 140 / 0.14)";
    ctx.fillRect(0, y + 0.6, W, 1);
  }

  const rr = Math.max(1.6, u * 0.055);
  const pitch = u * 0.6;
  const rivets = [];
  for (const x of seamsX) {
    for (let y = (seamsY[0] % pitch) - pitch; y < H + pitch; y += pitch) {
      rivets.push([x + u * 0.14, y]);
    }
  }
  for (const y of seamsY) {
    for (let x = (seamsX[0] % pitch) + pitch * 0.5; x < W + pitch; x += pitch) {
      rivets.push([x, y + u * 0.14]);
    }
  }
  for (const [x, y] of rivets) {
    if (rand() < 0.22) rustDrip(ctx, x, y + rr, u * (0.4 + rand() * 1.6), rr * (1.4 + rand() * 1.4), rand);
  }
  for (const [x, y] of rivets) rivet(ctx, x, y, rr * (0.9 + rand() * 0.2), rand, rand() < 0.16);

  for (let i = 0; i < 40; i += 1) {
    const x = rand() * W;
    const y = rand() * H;
    const len = u * (0.2 + rand() * 0.9);
    ctx.strokeStyle = `rgb(200 214 190 / ${0.06 + rand() * 0.1})`;
    ctx.lineWidth = 0.6 + rand() * 0.6;
    ctx.beginPath();
    ctx.moveTo(x, y);
    const a = (rand() - 0.5) * 0.9;
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  for (let i = 0; i < 260; i += 1) {
    const x = rand() * W;
    const y = rand() * H;
    const s = 0.5 + rand() * rand() * 2.4;
    ctx.fillStyle = rand() < 0.5 ? "rgb(14 26 20 / 0.5)" : "rgb(112 62 30 / 0.4)";
    ctx.beginPath();
    ctx.arc(x, y, s, 0, Math.PI * 2);
    ctx.fill();
  }

  drawLettering(ctx, layout, rand, dpr);
  for (const slot of layout.slots) drawSlot(ctx, slot, u, rand, dpr);
  drawRack(ctx, layout, rand);

  const grain = grainTile(rand);
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = 0.1;
  ctx.fillStyle = ctx.createPattern(grain, "repeat");
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.restore();
  return c;
}

function roughPatch(ctx, x, y, w, h, color, rand, u) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  const steps = 32;
  ctx.moveTo(x, y);
  for (let i = 0; i <= steps; i += 1) ctx.lineTo(x + (w * i) / steps, y + (rand() - 0.5) * u * 0.05);
  for (let i = 0; i <= steps; i += 1) ctx.lineTo(x + w + (rand() - 0.5) * u * 0.04, y + (h * i) / steps);
  for (let i = steps; i >= 0; i -= 1) ctx.lineTo(x + (w * i) / steps, y + h + (rand() - 0.5) * u * 0.05);
  for (let i = steps; i >= 0; i -= 1) ctx.lineTo(x + (rand() - 0.5) * u * 0.04, y + (h * i) / steps);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawRepaint(ctx, layout, rand) {
  for (const panel of layout.panels) roughPatch(ctx, panel.x, panel.y, panel.w, panel.h, "rgb(34 62 46 / 0.42)", rand, layout.u);
}

function drawLettering(ctx, layout, rand, dpr) {
  const { u, labels } = layout;
  for (const label of labels) {
    const painted = paintedText(label.text, label.h, rand, { squeeze: label.squeeze ?? 1, wear: 1.4, scale: dpr });
    const w = painted.width;
    const x = label.align === "center" ? label.x - w / 2 : label.x;
    const y = label.y - label.h / 2;
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.filter = `blur(${Math.max(0.5, u * 0.01)}px)`;
    ctx.globalCompositeOperation = "multiply";
    drawPainted(ctx, { ...painted, canvas: tintShadow(painted.canvas) }, x + u * 0.03, y + u * 0.012);
    ctx.restore();
    drawPainted(ctx, painted, x, y);
  }
}

function tintShadow(src) {
  const c = canvas(src.width, src.height);
  const ctx = c.getContext("2d");
  ctx.drawImage(src, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = "rgb(8 16 12)";
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}

function drawSlot(ctx, slot, u, rand) {
  const { x, y, w, h } = slot;
  const left = x - w / 2;
  const top = y - h / 2;
  const lip = Math.max(1.5, u * 0.045);

  ctx.save();
  ctx.fillStyle = "rgb(8 16 12 / 0.55)";
  ctx.filter = `blur(${Math.max(0.6, u * 0.02)}px)`;
  ctx.fillRect(left + u * 0.05, top + u * 0.03, w, h);
  ctx.restore();

  const back = ctx.createLinearGradient(left, top, left, top + h);
  back.addColorStop(0, "rgb(24 44 32)");
  back.addColorStop(0.4, "rgb(34 58 42)");
  back.addColorStop(1, "rgb(40 66 48)");
  ctx.fillStyle = back;
  ctx.fillRect(left, top, w, h);

  ctx.save();
  ctx.beginPath();
  ctx.rect(left, top, w, h);
  ctx.clip();
  const wall = ctx.createLinearGradient(left, 0, left + w * 0.34, 0);
  wall.addColorStop(0, "rgb(4 10 7 / 0.78)");
  wall.addColorStop(0.55, "rgb(4 10 7 / 0.32)");
  wall.addColorStop(1, "rgb(4 10 7 / 0)");
  ctx.fillStyle = wall;
  ctx.fillRect(left, top, w * 0.34, h);
  const lid = ctx.createLinearGradient(0, top, 0, top + h * 0.2);
  lid.addColorStop(0, "rgb(4 10 7 / 0.6)");
  lid.addColorStop(1, "rgb(4 10 7 / 0)");
  ctx.fillStyle = lid;
  ctx.fillRect(left, top, w, h * 0.2);
  for (let i = 0; i < 14; i += 1) {
    ctx.fillStyle = `rgb(110 62 30 / ${0.06 + rand() * 0.12})`;
    const sx = left + rand() * w;
    ctx.fillRect(sx, top + h * (0.5 + rand() * 0.5), 0.6 + rand() * 1.4, h * rand() * 0.4);
  }
  const railY = top + h * 0.1;
  ctx.fillStyle = "rgb(30 48 38)";
  ctx.fillRect(left, railY, w, Math.max(1.5, u * 0.035));
  ctx.fillStyle = "rgb(120 140 110 / 0.35)";
  ctx.fillRect(left, railY, w, 0.8);
  for (const hx of [x - w * 0.3, x + w * 0.3]) {
    const pr = Math.max(1.2, u * 0.03);
    const g = ctx.createRadialGradient(hx - pr * 0.4, railY - pr * 0.3, 0, hx, railY, pr);
    g.addColorStop(0, "rgb(180 170 140)");
    g.addColorStop(1, "rgb(40 40 32)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(hx, railY + pr * 0.4, pr, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();

  ctx.fillStyle = "rgb(214 200 160 / 0.5)";
  ctx.fillRect(left + w - 0.5, top + 1, lip * 0.5, h - 1);
  ctx.fillStyle = "rgb(214 200 160 / 0.32)";
  ctx.fillRect(left, top + h - 0.4, w, lip * 0.45);
  ctx.fillStyle = "rgb(6 12 9 / 0.7)";
  ctx.fillRect(left - lip * 0.4, top, lip * 0.4, h);
  ctx.fillRect(left - lip * 0.4, top - lip * 0.4, w + lip * 0.4, lip * 0.4);
}

function drawRack(ctx, layout, rand) {
  const { u } = layout;
  for (const row of layout.rackRows) {
    const { y, x0, x1 } = row;
    const h = Math.max(3, u * 0.1);
    ctx.save();
    ctx.fillStyle = "rgb(6 12 9 / 0.5)";
    ctx.filter = `blur(${Math.max(0.8, u * 0.025)}px)`;
    ctx.fillRect(x0 + u * 0.08, y + h * 0.4, x1 - x0, h * 1.2);
    ctx.restore();
    const g = ctx.createLinearGradient(0, y - h / 2, 0, y + h / 2);
    g.addColorStop(0, "rgb(170 176 146)");
    g.addColorStop(0.2, "rgb(84 112 88)");
    g.addColorStop(0.7, "rgb(36 60 44)");
    g.addColorStop(1, "rgb(16 28 20)");
    ctx.fillStyle = g;
    ctx.fillRect(x0, y - h / 2, x1 - x0, h);
    for (let i = 0; i < 8; i += 1) {
      const rx = x0 + rand() * (x1 - x0);
      ctx.fillStyle = `rgb(120 64 28 / ${0.2 + rand() * 0.3})`;
      ctx.fillRect(rx, y - h / 2, u * (0.05 + rand() * 0.3), h);
    }
    rivet(ctx, x0 + u * 0.12, y, Math.max(1.4, u * 0.04), rand, false);
    rivet(ctx, x1 - u * 0.12, y, Math.max(1.4, u * 0.04), rand, true);
  }
  for (const spot of layout.rack) {
    const hy = spot.railY;
    for (const dx of [-0.26, 0.26]) {
      const hx = spot.x + dx * u;
      ctx.strokeStyle = "rgb(30 34 28)";
      ctx.lineWidth = Math.max(1.2, u * 0.03);
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(hx, hy);
      ctx.lineTo(hx, hy + u * 0.1);
      ctx.stroke();
      ctx.strokeStyle = "rgb(190 180 150 / 0.6)";
      ctx.lineWidth = Math.max(0.6, u * 0.01);
      ctx.beginPath();
      ctx.moveTo(hx - u * 0.008, hy);
      ctx.lineTo(hx - u * 0.008, hy + u * 0.09);
      ctx.stroke();
    }
  }
}

export function bakePlate({ text, seed, pw, ph, u, dpr }) {
  const rand = makeRng(seed);
  const pad = Math.ceil(u * 0.04);
  const c = canvas((pw + pad * 2) * dpr, (ph + pad * 2) * dpr);
  const ctx = c.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.translate(pad, pad);
  const r = Math.max(1.5, u * 0.045);
  const bend = (rand() - 0.5) * u * 0.012;

  const outline = () => {
    ctx.beginPath();
    ctx.moveTo(r, 0);
    ctx.lineTo(pw - r, bend);
    ctx.quadraticCurveTo(pw, bend, pw, r + bend);
    ctx.lineTo(pw, ph - r);
    ctx.quadraticCurveTo(pw, ph, pw - r, ph);
    ctx.lineTo(r, ph - bend);
    ctx.quadraticCurveTo(0, ph - bend, 0, ph - r);
    ctx.lineTo(0, r);
    ctx.quadraticCurveTo(0, 0, r, 0);
    ctx.closePath();
  };

  outline();
  ctx.save();
  ctx.clip();
  const shade = 0.92 + rand() * 0.16;
  ctx.fillStyle = `rgb(${Math.round(40 * shade)} ${Math.round(74 * shade)} ${Math.round(54 * shade)})`;
  ctx.fillRect(0, 0, pw, ph);

  const fbm = makeFbm(rand, 4);
  const mottle = field(32, 48, (fx, fy) => {
    const v = 128 + (fbm(fx * 3, fy * 4.5) - 0.5) * 160;
    return [v, v, v, 255];
  });
  ctx.save();
  ctx.globalCompositeOperation = "soft-light";
  ctx.globalAlpha = 0.7;
  ctx.drawImage(mottle, 0, 0, pw, ph);
  ctx.restore();

  const grime = ctx.createLinearGradient(0, 0, 0, ph);
  grime.addColorStop(0, "rgb(200 210 180 / 0.05)");
  grime.addColorStop(0.6, "rgb(20 30 20 / 0)");
  grime.addColorStop(1, "rgb(30 24 14 / 0.3)");
  ctx.fillStyle = grime;
  ctx.fillRect(0, 0, pw, ph);

  const len = text.length;
  const capH = len > 1 ? ph * 0.5 : ph * 0.6;
  const squeeze = len > 1 ? 0.78 : 1;
  const painted = paintedText(text, capH, rand, { squeeze, wear: 0.8, scale: dpr });
  const tx = (pw - painted.width) / 2 + (rand() - 0.5) * u * 0.02;
  const ty = ph * 0.55 - capH / 2 + (rand() - 0.5) * u * 0.02;
  ctx.save();
  ctx.translate(pw / 2, ph / 2);
  ctx.rotate((rand() - 0.5) * 0.03);
  ctx.translate(-pw / 2, -ph / 2);
  drawPainted(ctx, painted, tx, ty);
  ctx.restore();

  const dents = 1 + Math.floor(rand() * 2.2);
  for (let i = 0; i < dents; i += 1) {
    const dx = pw * (0.15 + rand() * 0.7);
    const dy = ph * (0.15 + rand() * 0.75);
    const dr = u * (0.06 + rand() * 0.12);
    const a = rand() * Math.PI;
    ctx.save();
    ctx.translate(dx, dy);
    ctx.rotate(a);
    ctx.scale(1, 0.55 + rand() * 0.4);
    const dark = ctx.createRadialGradient(-dr * 0.35, 0, 0, -dr * 0.35, 0, dr);
    dark.addColorStop(0, "rgb(0 0 0 / 0.3)");
    dark.addColorStop(1, "rgb(0 0 0 / 0)");
    ctx.fillStyle = dark;
    ctx.beginPath();
    ctx.arc(-dr * 0.35, 0, dr, 0, Math.PI * 2);
    ctx.fill();
    const lit = ctx.createRadialGradient(dr * 0.35, 0, 0, dr * 0.35, 0, dr);
    lit.addColorStop(0, "rgb(255 240 210 / 0.22)");
    lit.addColorStop(1, "rgb(255 240 210 / 0)");
    ctx.fillStyle = lit;
    ctx.beginPath();
    ctx.arc(dr * 0.35, 0, dr, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  for (let i = 0; i < 6; i += 1) {
    ctx.strokeStyle = `rgb(210 220 196 / ${0.08 + rand() * 0.14})`;
    ctx.lineWidth = 0.5 + rand() * 0.4;
    const sx = rand() * pw;
    const sy = rand() * ph;
    const l = u * (0.08 + rand() * 0.3);
    const a = (rand() - 0.5) * 1.6;
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(sx + Math.cos(a) * l, sy + Math.sin(a) * l);
    ctx.stroke();
  }

  const chipLayer = canvas(pw * dpr, ph * dpr);
  const cc = chipLayer.getContext("2d");
  cc.scale(dpr, dpr);
  cc.fillStyle = "rgb(138 136 124)";
  const n = 3 + Math.floor(rand() * 6);
  for (let i = 0; i < n; i += 1) {
    const side = Math.floor(rand() * 4);
    let x = rand() * pw;
    let y = rand() * ph;
    if (side === 0) x = rand() * u * 0.04;
    if (side === 1) x = pw - rand() * u * 0.04;
    if (side === 2) y = rand() * u * 0.04;
    if (side === 3) y = ph - rand() * u * 0.04;
    const cr = u * (0.015 + Math.pow(rand(), 2) * 0.07);
    cc.beginPath();
    const k = 6;
    for (let j = 0; j < k; j += 1) {
      const a = (j / k) * Math.PI * 2;
      const rr = cr * (0.5 + rand() * 0.8);
      const px = x + Math.cos(a) * rr;
      const py = y + Math.sin(a) * rr;
      if (j === 0) cc.moveTo(px, py);
      else cc.lineTo(px, py);
    }
    cc.closePath();
    cc.fill();
    if (rand() < 0.2) {
      cc.save();
      cc.fillStyle = "rgb(124 62 24 / 0.75)";
      cc.beginPath();
      cc.arc(x, y, cr * 0.6, 0, Math.PI * 2);
      cc.fill();
      cc.restore();
    }
  }
  ctx.drawImage(chipLayer, 0, 0, pw, ph);

  if (rand() < 0.45) {
    const corner = rand() < 0.5 ? 0 : pw;
    const rust = ctx.createRadialGradient(corner, ph, 0, corner, ph, u * (0.2 + rand() * 0.25));
    rust.addColorStop(0, "rgb(122 58 22 / 0.7)");
    rust.addColorStop(0.5, "rgb(122 58 22 / 0.25)");
    rust.addColorStop(1, "rgb(122 58 22 / 0)");
    ctx.fillStyle = rust;
    ctx.fillRect(0, 0, pw, ph);
  }

  const hr = Math.max(1.2, u * 0.035);
  for (const hx of [pw * 0.2, pw * 0.8]) {
    const hy = ph * 0.07 + hr;
    ctx.fillStyle = "rgb(6 10 8)";
    ctx.beginPath();
    ctx.arc(hx, hy, hr, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgb(220 210 180 / 0.45)";
    ctx.lineWidth = 0.7;
    ctx.beginPath();
    ctx.arc(hx, hy, hr, -0.2, Math.PI * 0.9);
    ctx.stroke();
  }

  const edgeL = ctx.createLinearGradient(0, 0, u * 0.05, 0);
  edgeL.addColorStop(0, "rgb(255 240 200 / 0.45)");
  edgeL.addColorStop(1, "rgb(255 240 200 / 0)");
  ctx.fillStyle = edgeL;
  ctx.fillRect(0, 0, u * 0.05, ph);
  const edgeT = ctx.createLinearGradient(0, 0, 0, u * 0.035);
  edgeT.addColorStop(0, "rgb(255 240 200 / 0.3)");
  edgeT.addColorStop(1, "rgb(255 240 200 / 0)");
  ctx.fillStyle = edgeT;
  ctx.fillRect(0, 0, pw, u * 0.035);
  const edgeR = ctx.createLinearGradient(pw - u * 0.05, 0, pw, 0);
  edgeR.addColorStop(0, "rgb(0 0 0 / 0)");
  edgeR.addColorStop(1, "rgb(0 0 0 / 0.45)");
  ctx.fillStyle = edgeR;
  ctx.fillRect(pw - u * 0.05, 0, u * 0.05, ph);
  const edgeB = ctx.createLinearGradient(0, ph - u * 0.04, 0, ph);
  edgeB.addColorStop(0, "rgb(0 0 0 / 0)");
  edgeB.addColorStop(1, "rgb(0 0 0 / 0.4)");
  ctx.fillStyle = edgeB;
  ctx.fillRect(0, ph - u * 0.04, pw, u * 0.04);

  const grain = grainTile(rand, 64);
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = ctx.createPattern(grain, "repeat");
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.restore();

  return { canvas: c, pad };
}

export function bakeShadow({ pw, ph, u, dpr, blur }) {
  const pad = Math.ceil(blur * 3 + u * 0.05);
  const c = canvas((pw + pad * 2) * dpr, (ph + pad * 2) * dpr);
  const ctx = c.getContext("2d");
  ctx.scale(dpr, dpr);
  ctx.filter = `blur(${blur}px)`;
  ctx.fillStyle = "rgb(4 10 8)";
  const r = Math.max(1.5, u * 0.045);
  ctx.beginPath();
  ctx.roundRect(pad, pad, pw, ph, r);
  ctx.fill();
  return { canvas: c, pad };
}

export function bakeMote() {
  const c = canvas(32, 32);
  const ctx = c.getContext("2d");
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, "rgb(255 226 170 / 1)");
  g.addColorStop(0.18, "rgb(255 214 150 / 0.75)");
  g.addColorStop(0.45, "rgb(255 200 130 / 0.22)");
  g.addColorStop(0.75, "rgb(255 190 120 / 0.05)");
  g.addColorStop(1, "rgb(255 190 120 / 0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 32, 32);
  return c;
}
