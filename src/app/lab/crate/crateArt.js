import { measureHand, writeHand } from "./crateHand";

const TRACKS = [
  "Low Hours",
  "Glass Stairs",
  "Coat Check",
  "Night Bus",
  "Sodium",
  "Taxi Rank",
  "Strobe Rain",
  "Velvet Rope",
  "Cloakroom",
  "Exit Sign",
  "Long Hallway",
  "Last Train",
  "Mirror Tile",
  "Warm Up",
  "Back Room",
  "Daybreak",
];

export function mk(w, h = w) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

export function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function noiseCanvas(size, seed, soft = 1) {
  const c = mk(size);
  const ctx = c.getContext("2d");
  const data = ctx.createImageData(size, size);
  const r = rng(seed);
  for (let i = 0; i < size * size; i += 1) {
    const v = 128 + (r() - 0.5) * 255 * soft;
    data.data[i * 4] = v;
    data.data[i * 4 + 1] = v;
    data.data[i * 4 + 2] = v;
    data.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);
  return c;
}

function fibres(ctx, w, h, seed, count, tone, alpha) {
  const r = rng(seed);
  ctx.save();
  ctx.lineCap = "round";
  for (let i = 0; i < count; i += 1) {
    const x = r() * w;
    const y = r() * h;
    const a = r() * Math.PI;
    const len = (0.004 + r() * 0.014) * w;
    ctx.strokeStyle = tone;
    ctx.globalAlpha = alpha * (0.3 + r() * 0.7);
    ctx.lineWidth = Math.max(0.5, w / 1400);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(
      x + Math.cos(a + 0.6) * len * 0.5,
      y + Math.sin(a + 0.6) * len * 0.5,
      x + Math.cos(a) * len,
      y + Math.sin(a) * len,
    );
    ctx.stroke();
  }
  ctx.restore();
}

function grainOver(ctx, size, grain, alpha, mode = "overlay") {
  ctx.save();
  ctx.globalCompositeOperation = mode;
  ctx.globalAlpha = alpha;
  const pat = ctx.createPattern(grain, "repeat");
  ctx.fillStyle = pat;
  ctx.fillRect(0, 0, size, size);
  ctx.restore();
}

function cropSquare(img, focus) {
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  const s = Math.min(w, h);
  return [w > h ? (w - s) * focus : 0, h > w ? (h - s) * focus : 0, s, s];
}

function font(weight, px, family) {
  return `${weight} ${Math.round(px)}px ${family}`;
}

function stamp(ctx, size, seed, draw, color, alpha) {
  const layer = mk(size);
  const l = layer.getContext("2d");
  l.fillStyle = color;
  l.strokeStyle = color;
  draw(l);
  l.globalCompositeOperation = "destination-out";
  const r = rng(seed);
  for (let i = 0; i < 900; i += 1) {
    l.globalAlpha = 0.25 + r() * 0.6;
    l.beginPath();
    l.arc(
      r() * size,
      r() * size,
      (0.5 + r() * 2.6) * (size / 768),
      0,
      Math.PI * 2,
    );
    l.fill();
  }
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.globalCompositeOperation = "multiply";
  ctx.drawImage(layer, 0, 0);
  ctx.restore();
}

function maskingTape(ctx, x, y, w, h, angle, seed, text, bump, rough, scale) {
  const r = rng(seed);
  const draw = (c, fill) => {
    c.save();
    c.translate(x, y);
    c.rotate(angle);
    c.beginPath();
    c.moveTo(-w / 2, -h / 2);
    for (let i = 0; i <= 8; i += 1)
      c.lineTo(-w / 2 + (w * i) / 8, -h / 2 + (r() - 0.5) * h * 0.04);
    for (let i = 0; i <= 6; i += 1)
      c.lineTo(w / 2 + (r() - 0.5) * h * 0.12, -h / 2 + (h * i) / 6);
    for (let i = 8; i >= 0; i -= 1)
      c.lineTo(-w / 2 + (w * i) / 8, h / 2 + (r() - 0.5) * h * 0.04);
    for (let i = 6; i >= 0; i -= 1)
      c.lineTo(-w / 2 + (r() - 0.5) * h * 0.12, -h / 2 + (h * i) / 6);
    c.closePath();
    c.fillStyle = fill;
    c.fill();
    c.restore();
  };
  ctx.save();
  ctx.shadowColor = "rgba(40, 30, 10, 0.25)";
  ctx.shadowBlur = h * 0.06;
  ctx.shadowOffsetY = h * 0.02;
  draw(ctx, "rgba(226, 212, 176, 0.94)");
  ctx.restore();
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const sheen = ctx.createLinearGradient(-w / 2, -h / 2, w / 2, h / 2);
  sheen.addColorStop(0, "rgba(255, 252, 240, 0.0)");
  sheen.addColorStop(0.45, "rgba(255, 252, 240, 0.14)");
  sheen.addColorStop(0.55, "rgba(255, 252, 240, 0.05)");
  sheen.addColorStop(1, "rgba(120, 100, 60, 0.08)");
  ctx.fillStyle = sheen;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  fibres(ctx, w, h, seed + 4, 40, "#a08a5a", 0.25);
  ctx.restore();
  if (text) {
    const sizePx = h * 0.42;
    const tw = measureHand(text, sizePx);
    const fit = Math.min(1, (w * 0.86) / tw);
    writeHand(ctx, text, {
      x:
        x -
        (Math.cos(angle) * (tw * fit)) / 2 +
        Math.sin(angle) * sizePx * fit * 0.3,
      y:
        y -
        (Math.sin(angle) * (tw * fit)) / 2 +
        Math.cos(angle) * sizePx * fit * 0.3,
      size: sizePx * fit,
      angle,
      seed: seed + 11,
      color: "#20202e",
      width: 0.085,
    });
  }
  draw(bump, "rgb(150, 150, 150)");
  draw(
    rough,
    `rgb(${Math.round(scale * 150)}, ${Math.round(scale * 150)}, ${Math.round(scale * 150)})`,
  );
}

function priceSticker(ctx, size, text, seed, bump, rough) {
  const r = rng(seed);
  const cx = size * (0.8 + r() * 0.06);
  const cy = size * (0.12 + r() * 0.05);
  const rad = size * 0.052;
  ctx.save();
  ctx.shadowColor = "rgba(20, 14, 6, 0.3)";
  ctx.shadowBlur = size * 0.004;
  ctx.shadowOffsetY = size * 0.002;
  ctx.beginPath();
  ctx.arc(cx, cy, rad, 0, Math.PI * 2);
  const g = ctx.createRadialGradient(
    cx - rad * 0.3,
    cy - rad * 0.3,
    rad * 0.1,
    cx,
    cy,
    rad,
  );
  g.addColorStop(0, "#fbf8f0");
  g.addColorStop(0.7, "#f3eee2");
  g.addColorStop(1, "#e8e1d0");
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
  const px = rad * 0.82;
  const tw = measureHand(text, px);
  writeHand(ctx, text, {
    x: cx - tw / 2 + px * 0.05,
    y: cy + px * 0.36,
    size: px,
    seed: seed + 3,
    color: "#1f2a6b",
    width: 0.11,
    angle: (r() - 0.5) * 0.3,
    slant: 0.1,
  });
  bump.fillStyle = "rgb(170,170,170)";
  bump.beginPath();
  bump.arc(cx, cy, rad, 0, Math.PI * 2);
  bump.fill();
  rough.fillStyle = "rgb(70,70,70)";
  rough.beginPath();
  rough.arc(cx, cy, rad, 0, Math.PI * 2);
  rough.fill();
}

function wear(ctx, size, seed, amount, bump, rough, light) {
  const r = rng(seed);
  const ring = mk(size);
  const rc = ring.getContext("2d");
  const cx = size * (0.5 + (r() - 0.5) * 0.02);
  const cy = size * (0.5 + (r() - 0.5) * 0.02);
  const rad = size * 0.475;
  rc.lineCap = "round";
  for (let i = 0; i < 220; i += 1) {
    const a0 = r() * Math.PI * 2;
    const len = 0.05 + r() * 0.35;
    rc.globalAlpha = (0.015 + r() * 0.05) * amount;
    rc.strokeStyle = light;
    rc.lineWidth = size * (0.004 + r() * 0.014);
    rc.beginPath();
    rc.arc(cx, cy, rad - size * (r() * 0.012), a0, a0 + len);
    rc.stroke();
  }
  const inner = rad * 0.34;
  for (let i = 0; i < 40; i += 1) {
    const a0 = r() * Math.PI * 2;
    rc.globalAlpha = (0.02 + r() * 0.05) * amount;
    rc.lineWidth = size * (0.004 + r() * 0.01);
    rc.strokeStyle = light;
    rc.beginPath();
    rc.arc(cx, cy, inner, a0, a0 + 0.2 + r() * 0.6);
    rc.stroke();
  }
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.drawImage(ring, 0, 0);
  ctx.restore();
  bump.save();
  bump.filter = `blur(${Math.max(1, size * 0.01)}px)`;
  bump.globalAlpha = 0.12 * amount;
  bump.strokeStyle = "rgb(200,200,200)";
  bump.lineWidth = size * 0.012;
  bump.beginPath();
  bump.arc(cx, cy, rad, 0, Math.PI * 2);
  bump.stroke();
  bump.globalAlpha = 0.12 * amount;
  bump.beginPath();
  bump.arc(cx, cy, inner, 0, Math.PI * 2);
  bump.stroke();
  bump.restore();
  rough.save();
  rough.filter = `blur(${Math.max(1, size * 0.004)}px)`;
  rough.globalCompositeOperation = "lighter";
  rough.globalAlpha = 0.6;
  rough.drawImage(ring, 0, 0);
  rough.restore();
  const edge = mk(size);
  const ec = edge.getContext("2d");
  ec.fillStyle = light;
  for (let i = 0; i < 1400 * amount; i += 1) {
    const side = Math.floor(r() * 4);
    const t = r() * size;
    const d = Math.pow(r(), 3) * size * 0.022;
    const x = side === 0 ? d : side === 1 ? size - d : t;
    const y = side === 2 ? d : side === 3 ? size - d : t;
    ec.globalAlpha = 0.08 + r() * 0.35;
    ec.beginPath();
    ec.ellipse(
      x,
      y,
      size * (0.0015 + r() * 0.004),
      size * (0.0015 + r() * 0.004),
      r() * 3,
      0,
      Math.PI * 2,
    );
    ec.fill();
  }
  for (const [x, y] of [
    [0, 0],
    [size, 0],
    [0, size],
    [size, size],
  ]) {
    const g = ec.createRadialGradient(
      x,
      y,
      0,
      x,
      y,
      size * (0.03 + r() * 0.03) * amount,
    );
    g.addColorStop(0, "rgba(255,255,255,0.75)");
    g.addColorStop(0.5, "rgba(255,255,255,0.25)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ec.globalAlpha = 1;
    ec.globalCompositeOperation = "source-over";
    ec.fillStyle = g;
    ec.fillRect(0, 0, size, size);
    ec.fillStyle = light;
  }
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.globalAlpha = 0.85;
  ctx.drawImage(edge, 0, 0);
  ctx.restore();
  rough.save();
  rough.globalCompositeOperation = "lighter";
  rough.drawImage(edge, 0, 0);
  rough.restore();
  ctx.save();
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = size * 0.003;
  ctx.strokeRect(size * 0.0015, size * 0.0015, size * 0.997, size * 0.997);
  ctx.restore();
}

function merge(size, bumpCanvas, roughCanvas) {
  const out = mk(size);
  const o = out.getContext("2d");
  const b = bumpCanvas.getContext("2d").getImageData(0, 0, size, size).data;
  const g = roughCanvas.getContext("2d").getImageData(0, 0, size, size).data;
  const img = o.createImageData(size, size);
  for (let i = 0; i < size * size * 4; i += 4) {
    img.data[i] = b[i];
    img.data[i + 1] = g[i];
    img.data[i + 2] = 0;
    img.data[i + 3] = 255;
  }
  o.putImageData(img, 0, 0);
  return out;
}

export function coverArt(spec, img, size, seed, family, grain) {
  const c = mk(size);
  const ctx = c.getContext("2d");
  const bumpC = mk(size);
  const bump = bumpC.getContext("2d");
  bump.fillStyle = "rgb(128,128,128)";
  bump.fillRect(0, 0, size, size);
  const roughC = mk(size);
  const rough = roughC.getContext("2d");
  const baseRough = Math.round((0.86 - spec.gloss * 0.62) * 255);
  rough.fillStyle = `rgb(${baseRough},${baseRough},${baseRough})`;
  rough.fillRect(0, 0, size, size);
  const r = rng(seed);
  const s = size;
  ctx.imageSmoothingQuality = "high";
  let light = "#d8d0c2";

  if (spec.kind === "photo") {
    ctx.save();
    ctx.filter = "grayscale(1) contrast(1.12) brightness(0.98)";
    ctx.drawImage(img, ...cropSquare(img, spec.focus), 0, 0, s, s);
    ctx.restore();
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = "rgb(238, 230, 214)";
    ctx.fillRect(0, 0, s, s);
    ctx.restore();
    const shade = ctx.createLinearGradient(0, 0, 0, s * 0.3);
    shade.addColorStop(0, "rgba(0,0,0,0.42)");
    shade.addColorStop(0.4, "rgba(0,0,0,0.22)");
    shade.addColorStop(0.75, "rgba(0,0,0,0.06)");
    shade.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = shade;
    ctx.fillRect(0, 0, s, s * 0.3);
    ctx.fillStyle = "#f3ede1";
    ctx.textBaseline = "alphabetic";
    ctx.font = font(640, s * 0.05, family);
    ctx.fillText(spec.artist, s * 0.055, s * 0.1);
    ctx.font = font(440, s * 0.05, family);
    ctx.fillText(spec.title, s * 0.055, s * 0.16);
    ctx.font = font(520, s * 0.022, family);
    ctx.textAlign = "right";
    ctx.fillText(spec.cat, s * 0.945, s * 0.1);
    ctx.textAlign = "left";
    grainOver(ctx, s, grain, 0.22);
    light = "#ece6da";
  } else if (spec.kind === "inset") {
    ctx.fillStyle = spec.ground;
    ctx.fillRect(0, 0, s, s);
    fibres(ctx, s, s, seed, 500, spec.inkTone, 0.05);
    const pad = s * 0.1;
    const side = s - pad * 2;
    const ph = side * 0.72;
    ctx.save();
    ctx.filter = "contrast(1.04) saturate(0.92)";
    const [sx, sy, sw, sh] = cropSquare(img, spec.focus);
    ctx.drawImage(img, sx, sy + sh * 0.0, sw, sh * 0.72, pad, pad, side, ph);
    ctx.restore();
    ctx.fillStyle = spec.inkTone;
    ctx.font = font(640, s * 0.062, family);
    ctx.fillText(spec.artist, pad, pad + ph + s * 0.1);
    ctx.font = font(440, s * 0.062, family);
    ctx.fillText(spec.title, pad, pad + ph + s * 0.17);
    ctx.font = font(520, s * 0.022, family);
    ctx.textAlign = "right";
    ctx.fillText(spec.cat, s - pad, pad + ph + s * 0.1);
    ctx.textAlign = "left";
    grainOver(ctx, s, grain, 0.16);
  } else if (spec.kind === "swiss") {
    ctx.fillStyle = "#ece4d4";
    ctx.fillRect(0, 0, s, s);
    fibres(ctx, s, s, seed, 1400, "#8a7a5c", 0.12);
    stamp(
      ctx,
      s,
      seed + 1,
      (l) => {
        l.font = font(700, s * 0.62, family);
        l.textBaseline = "alphabetic";
        l.fillText("124", -s * 0.035, s * 0.93);
      },
      "#e8481f",
      0.92,
    );
    stamp(
      ctx,
      s,
      seed + 2,
      (l) => {
        l.fillRect(s * 0.06, s * 0.06, s * 0.88, s * 0.006);
        l.fillRect(s * 0.06, s * 0.3, s * 0.88, s * 0.003);
        l.font = font(640, s * 0.06, family);
        l.fillText("Unit Six", s * 0.06, s * 0.16);
        l.font = font(440, s * 0.06, family);
        l.fillText("Tempo", s * 0.06, s * 0.23);
        l.font = font(520, s * 0.024, family);
        [
          "A1  Count In",
          "A2  Sodium",
          "B1  Long Hallway",
          "B2  Warm Up",
        ].forEach((t, i) => l.fillText(t, s * 0.56, s * 0.135 + i * s * 0.036));
        l.fillText("U6-03   33 rpm", s * 0.06, s * 0.27);
      },
      "#1b1a18",
      0.9,
    );
    light = "#f8f2e6";
  } else if (spec.kind === "circle") {
    ctx.fillStyle = "#1f3c8c";
    ctx.fillRect(0, 0, s, s);
    grainOver(ctx, s, grain, 0.18);
    stamp(
      ctx,
      s,
      seed + 1,
      (l) => {
        l.beginPath();
        l.arc(s * 0.58, s * 0.46, s * 0.3, 0, Math.PI * 2);
        l.fill();
      },
      "#efe9dc",
      1,
    );
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#efe9dc";
    ctx.font = font(640, s * 0.05, family);
    ctx.fillText("Blue Room", s * 0.06, s * 0.88);
    ctx.font = font(440, s * 0.05, family);
    ctx.fillText("Night Service", s * 0.06, s * 0.94);
    ctx.font = font(520, s * 0.022, family);
    ctx.textAlign = "right";
    ctx.fillText("BR-21", s * 0.94, s * 0.94);
    ctx.restore();
    ctx.fillStyle = "#1f3c8c";
    ctx.font = font(520, s * 0.024, family);
    ctx.textAlign = "center";
    ctx.fillText("side a  /  side b", s * 0.58, s * 0.47);
    ctx.textAlign = "left";
    light = "#9fb2de";
  } else if (spec.kind === "diecut") {
    ctx.fillStyle = spec.paper;
    ctx.fillRect(0, 0, s, s);
    fibres(
      ctx,
      s,
      s,
      seed,
      1600,
      spec.paper === "#151413" ? "#3a3632" : "#a89c80",
      0.2,
    );
    grainOver(ctx, s, grain, 0.12);
    light = spec.paper === "#151413" ? "#55504a" : "#fbf7ee";
  } else if (spec.kind === "kraft") {
    ctx.fillStyle = "#b28f63";
    ctx.fillRect(0, 0, s, s);
    fibres(ctx, s, s, seed, 3200, "#6e5232", 0.22);
    fibres(ctx, s, s, seed + 9, 900, "#e2c9a2", 0.2);
    grainOver(ctx, s, grain, 0.25);
    stamp(
      ctx,
      s,
      seed + 1,
      (l) => {
        l.lineWidth = s * 0.012;
        l.beginPath();
        l.arc(s * 0.3, s * 0.68, s * 0.15, 0, Math.PI * 2);
        l.stroke();
        l.lineWidth = s * 0.005;
        l.beginPath();
        l.arc(s * 0.3, s * 0.68, s * 0.125, 0, Math.PI * 2);
        l.stroke();
        l.textAlign = "center";
        l.font = font(640, s * 0.05, family);
        l.fillText("Side B", s * 0.3, s * 0.675);
        l.font = font(520, s * 0.024, family);
        l.fillText("records  /  12 in", s * 0.3, s * 0.72);
      },
      "#1e2c55",
      0.78,
    );
    maskingTape(
      ctx,
      s * 0.6,
      s * 0.2,
      s * 0.62,
      s * 0.11,
      -0.04,
      seed + 5,
      spec.hand,
      bump,
      rough,
      1,
    );
    light = "#d9bf96";
  } else if (spec.kind === "tape") {
    ctx.fillStyle = "#ede8dc";
    ctx.fillRect(0, 0, s, s);
    fibres(ctx, s, s, seed, 1800, "#9c917a", 0.14);
    const yell = ctx.createRadialGradient(
      s * 0.5,
      s * 0.5,
      s * 0.2,
      s * 0.5,
      s * 0.5,
      s * 0.75,
    );
    yell.addColorStop(0, "rgba(200,170,100,0)");
    yell.addColorStop(0.6, "rgba(200,170,100,0.05)");
    yell.addColorStop(1, "rgba(200,170,100,0.16)");
    ctx.fillStyle = yell;
    ctx.fillRect(0, 0, s, s);
    stamp(
      ctx,
      s,
      seed + 1,
      (l) => {
        l.save();
        l.translate(s * 0.62, s * 0.72);
        l.rotate(-0.12);
        l.lineWidth = s * 0.008;
        l.strokeRect(-s * 0.24, -s * 0.07, s * 0.48, s * 0.14);
        l.font = font(700, s * 0.06, family);
        l.textAlign = "center";
        l.textBaseline = "middle";
        l.fillText("Test pressing", 0, 0);
        l.restore();
      },
      "#b8322a",
      0.7,
    );
    maskingTape(
      ctx,
      s * 0.42,
      s * 0.22,
      s * 0.7,
      s * 0.11,
      0.03,
      seed + 5,
      spec.hand,
      bump,
      rough,
      1,
    );
    light = "#fbf8f0";
  }

  if (spec.price) priceSticker(ctx, s, spec.price, seed + 20, bump, rough);
  wear(ctx, s, seed + 30, spec.wear, bump, rough, light);
  if (spec.kind === "diecut") {
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.168, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    const lip = mk(s);
    const lc = lip.getContext("2d");
    lc.strokeStyle = light;
    lc.lineWidth = s * 0.008;
    lc.globalAlpha = 0.5;
    lc.beginPath();
    lc.arc(s / 2, s / 2, s * 0.172, 0, Math.PI * 2);
    lc.stroke();
    ctx.save();
    ctx.globalCompositeOperation = "source-atop";
    ctx.drawImage(lip, 0, 0);
    ctx.restore();
  }
  return { map: c, surface: merge(s, bumpC, roughC) };
}

export function backArt(spec, size, seed, family, grain, frontMap) {
  const s = size;
  if (spec.kind === "diecut") return frontMap;
  const c = mk(s);
  const ctx = c.getContext("2d");
  const r = rng(seed + 77);
  if (spec.kind === "kraft") {
    ctx.fillStyle = "#b08d62";
    ctx.fillRect(0, 0, s, s);
    fibres(ctx, s, s, seed + 3, 2400, "#6e5232", 0.22);
    grainOver(ctx, s, grain, 0.25);
    return c;
  }
  if (spec.kind === "tape") {
    ctx.fillStyle = "#ebe6da";
    ctx.fillRect(0, 0, s, s);
    fibres(ctx, s, s, seed + 3, 1400, "#9c917a", 0.14);
    return c;
  }
  const dark = spec.kind === "circle";
  const ground = dark
    ? "#1f3c8c"
    : spec.kind === "inset"
      ? spec.ground
      : "#ece6da";
  const ink = dark
    ? "#efe9dc"
    : spec.kind === "inset"
      ? spec.inkTone
      : "#1d1c1a";
  ctx.fillStyle = ground;
  ctx.fillRect(0, 0, s, s);
  fibres(ctx, s, s, seed + 3, 900, ink, 0.05);
  ctx.fillStyle = ink;
  ctx.font = font(640, s * 0.04, family);
  ctx.fillText(spec.artist, s * 0.08, s * 0.13);
  ctx.font = font(440, s * 0.04, family);
  ctx.fillText(spec.title, s * 0.08, s * 0.18);
  ctx.font = font(460, s * 0.026, family);
  const pick = TRACKS.slice().sort(() => r() - 0.5);
  for (let i = 0; i < 4; i += 1)
    ctx.fillText(`A${i + 1}   ${pick[i]}`, s * 0.08, s * 0.3 + i * s * 0.045);
  for (let i = 0; i < 4; i += 1)
    ctx.fillText(
      `B${i + 1}   ${pick[i + 4]}`,
      s * 0.52,
      s * 0.3 + i * s * 0.045,
    );
  ctx.font = font(440, s * 0.018, family);
  [
    "Recorded live to two-track, mastered for vinyl.",
    "Cut at 33 rpm. Play loud.",
    `${spec.cat}  /  made in a basement`,
  ].forEach((t, i) => ctx.fillText(t, s * 0.08, s * 0.62 + i * s * 0.03));
  const bx = s * 0.72;
  const by = s * 0.8;
  ctx.fillStyle = dark ? "#efe9dc" : "#fbf8f2";
  ctx.fillRect(bx - s * 0.02, by - s * 0.02, s * 0.24, s * 0.13);
  ctx.fillStyle = "#151515";
  let x = bx;
  while (x < bx + s * 0.2) {
    const w = s * (0.002 + r() * 0.005);
    ctx.fillRect(x, by, w, s * 0.075);
    x += w + s * (0.002 + r() * 0.004);
  }
  ctx.font = font(520, s * 0.014, family);
  ctx.fillText(
    `0 ${Math.floor(10000 + r() * 89999)} ${Math.floor(10000 + r() * 89999)} 4`,
    bx,
    by + s * 0.1,
  );
  grainOver(ctx, s, grain, 0.14);
  return c;
}

export function edgeArt(size) {
  const c = mk(size, size / 4);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#cfc6b4";
  ctx.fillRect(0, 0, size, size / 4);
  const r = rng(5);
  for (let i = 0; i < 400; i += 1) {
    ctx.fillStyle =
      r() > 0.5 ? "rgba(90,74,50,0.12)" : "rgba(255,250,240,0.18)";
    ctx.fillRect(r() * size, r() * (size / 4), size * (0.01 + r() * 0.05), 1);
  }
  return c;
}

export function labelArt(spec, size, family) {
  const c = mk(size);
  const ctx = c.getContext("2d");
  const L = spec.label;
  const s = size;
  ctx.fillStyle = "#0b0b0c";
  ctx.fillRect(0, 0, s, s);
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
  ctx.fillStyle = L.paper;
  ctx.fill();
  fibres(ctx, s, s, 41, 300, L.ink, 0.06);
  ctx.fillStyle = L.ink;
  ctx.strokeStyle = L.ink;
  ctx.textAlign = "center";
  if (L.lines) {
    ctx.font = font(640, s * 0.085, family);
    ctx.fillText(L.lines[0], s / 2, s * 0.3);
    ctx.font = font(440, s * 0.07, family);
    ctx.fillText(L.lines[1], s / 2, s * 0.76);
    ctx.font = font(520, s * 0.04, family);
    ctx.fillText(`side a   33 rpm   ${spec.cat}`, s / 2, s * 0.86);
    ctx.lineWidth = s * 0.004;
    ctx.globalAlpha = 0.5;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.46, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else if (L.hand) {
    L.hand.forEach((t, i) => {
      const px = s * 0.1;
      const tw = measureHand(t, px);
      writeHand(ctx, t, {
        x: s / 2 - tw / 2,
        y: s * (0.3 + i * 0.5),
        size: px,
        seed: 50 + i,
        color: L.handInk || "#1d1b2a",
        width: 0.08,
        angle: (i - 0.5) * 0.08,
      });
    });
  }
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s * 0.072, 0, Math.PI * 2);
  ctx.fillStyle = "#101010";
  ctx.fill();
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s * 0.072, 0, Math.PI * 2);
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = s * 0.006;
  ctx.stroke();
  return c;
}

export function vinylMaps(size, inner, outer) {
  const aniso = mk(size);
  const rough = mk(size);
  const a = aniso.getContext("2d").createImageData(size, size);
  const g = rough.getContext("2d").createImageData(size, size);
  const gaps = [0.93, 0.79, 0.66, 0.55];
  const half = size / 2;
  const r = rng(13);
  const wob = Array.from({ length: 64 }, () => r());
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = (x + 0.5 - half) / half;
      const dy = (y + 0.5 - half) / half;
      const rad = Math.sqrt(dx * dx + dy * dy);
      const phi = Math.atan2(dy, dx);
      const i = (y * size + x) * 4;
      const t = (rad - inner) / Math.max(1e-4, outer - inner);
      let strength = 0;
      let rv = 0.26;
      if (rad > inner * 1.02 && rad < 0.985) {
        strength = 1;
        rv = 0.46 + 0.06 * Math.sin(rad * 520 + wob[Math.floor(rad * 63)] * 6);
        if (t < 0) {
          strength = 0.55;
          rv = 0.14;
        }
        for (const gp of gaps)
          if (Math.abs(t - gp) < 0.008) {
            strength = 0.35;
            rv = 0.12;
          }
      }
      if (rad >= 0.985) {
        strength = 0.4;
        rv = 0.16;
      }
      const tx = -Math.sin(phi);
      const ty = Math.cos(phi);
      a.data[i] = Math.round((tx * 0.5 + 0.5) * 255);
      a.data[i + 1] = Math.round((-ty * 0.5 + 0.5) * 255);
      a.data[i + 2] = Math.round(strength * 255);
      a.data[i + 3] = 255;
      const v = Math.round(Math.min(1, Math.max(0, rv)) * 255);
      g.data[i] = v;
      g.data[i + 1] = v;
      g.data[i + 2] = 0;
      g.data[i + 3] = 255;
    }
  }
  aniso.getContext("2d").putImageData(a, 0, 0);
  rough.getContext("2d").putImageData(g, 0, 0);
  return { aniso, rough };
}

export function plyFace(size, seed, tone) {
  const c = mk(size);
  const ctx = c.getContext("2d");
  ctx.fillStyle = tone;
  ctx.fillRect(0, 0, size, size);
  const r = rng(seed);
  for (let i = 0; i < 140; i += 1) {
    const y0 = r() * size;
    const amp = size * (0.004 + r() * 0.02);
    const freq = 1 + r() * 3;
    const ph = r() * 6.28;
    ctx.strokeStyle =
      r() > 0.5 ? "rgba(120,84,48,0.07)" : "rgba(255,244,222,0.08)";
    ctx.lineWidth = size * (0.001 + r() * 0.004);
    ctx.beginPath();
    for (let x = 0; x <= size; x += size / 64) {
      const y = y0 + Math.sin((x / size) * Math.PI * 2 * freq + ph) * amp;
      if (x === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  for (let i = 0; i < 6; i += 1) {
    const x = r() * size;
    const y = r() * size;
    const g = ctx.createRadialGradient(x, y, 0, x, y, size * 0.03);
    g.addColorStop(0, "rgba(110,70,35,0.35)");
    g.addColorStop(0.5, "rgba(110,70,35,0.12)");
    g.addColorStop(1, "rgba(110,70,35,0)");
    ctx.fillStyle = g;
    ctx.fillRect(x - size * 0.05, y - size * 0.05, size * 0.1, size * 0.1);
  }
  return c;
}

export function plyEdge(size) {
  const c = mk(size);
  const ctx = c.getContext("2d");
  const layers = 7;
  for (let i = 0; i < layers; i += 1) {
    ctx.fillStyle = i % 2 ? "#c4a986" : "#dfcaa8";
    ctx.fillRect(0, (i * size) / layers, size, size / layers + 1);
    ctx.fillStyle = "rgba(90,60,30,0.35)";
    ctx.fillRect(0, (i * size) / layers, size, Math.max(1, size / 120));
  }
  return c;
}

export function floorArt(size, grain) {
  const c = mk(size);
  const ctx = c.getContext("2d");
  ctx.fillStyle = "#e6e0d6";
  ctx.fillRect(0, 0, size, size);
  grainOver(ctx, size, grain, 0.08, "soft-light");
  fibres(ctx, size, size, 3, 500, "#8d8372", 0.06);
  return c;
}
