export const CARD_W = 1.6;
export const CARD_H = 2.25;
export const CARD_R = 0.09;
export const SLOT = { w: 0.36, h: 0.075, y: CARD_H / 2 - 0.15 };
export const PX = 640;
export const STRAP_COLOR = "#2d4bd8";

const TEX_W = Math.round(CARD_W * PX);
const TEX_H = Math.round(CARD_H * PX);

const INK = "#f4f4f2";
const QUIET = "#a3a3a8";
const RULE = "#2c2c30";
const GROUND = "#0c0c0e";

export const PIECES = ["Split Flap", "Refractor", "Ink Drag", "Sticker Peel", "Film Leader", "Dandelion", "Mirrorball", "Type Bust"];

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function newCanvas(w = TEX_W, h = TEX_H) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export async function loadFonts(host) {
  const probe = document.createElement("span");
  probe.style.fontFamily = "var(--font-mono)";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  host.appendChild(probe);
  const mono = getComputedStyle(probe).fontFamily || "monospace";
  probe.remove();
  const sans = getComputedStyle(host).fontFamily || "sans-serif";
  try {
    await Promise.all([
      document.fonts.load(`600 120px ${sans}`, "Herb"),
      document.fonts.load(`460 40px ${sans}`, "Herb"),
      document.fonts.load(`500 40px ${mono}`, "0123"),
    ]);
  } catch {}
  return { sans, mono };
}


function face(ctx, cx, cy, size, ink, white) {
  const s = size / 64;
  ctx.save();
  ctx.translate(cx - 32 * s, cy - 32 * s);
  ctx.scale(s, s);
  ctx.strokeStyle = ink;
  ctx.lineCap = "round";
  ctx.lineWidth = 4.2;
  ctx.beginPath();
  ctx.arc(32, 32, 28.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 3;
  for (const ex of [20, 44]) {
    ctx.beginPath();
    ctx.ellipse(ex, 26, 7.6, 9, 0, 0, Math.PI * 2);
    ctx.fillStyle = white;
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(ex, 26, 4.1, 0, Math.PI * 2);
    ctx.fillStyle = ink;
    ctx.fill();
  }
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.arc(32, 41, 10, Math.PI * 0.1667, Math.PI * 0.8333);
  ctx.stroke();
  ctx.restore();
}

function barcode(ctx, x, y, w, h, color) {
  const rand = mulberry(48117);
  const units = [];
  let total = 0;
  while (total < 150) {
    const bar = 1 + Math.floor(rand() * 3.2);
    const gap = 1 + Math.floor(rand() * 2.6);
    units.push(bar, gap);
    total += bar + gap;
  }
  const unit = w / total;
  ctx.fillStyle = color;
  let at = x;
  for (let i = 0; i < units.length; i += 2) {
    ctx.fillRect(Math.round(at), y, Math.max(1, Math.round(units[i] * unit)), h);
    at += (units[i] + units[i + 1]) * unit;
  }
}

export const FOIL = { x: 72, y: 268, w: TEX_W - 144, h: 600, r: 28 };

function foilBase(ctx) {
  const { x, y, w, h, r } = FOIL;
  ctx.save();
  roundRect(ctx, x, y, w, h, r);
  ctx.clip();
  const g = ctx.createLinearGradient(x, y, x + w, y + h);
  g.addColorStop(0, "#dfe2e6");
  g.addColorStop(0.22, "#c9ced4");
  g.addColorStop(0.48, "#eef0f2");
  g.addColorStop(0.71, "#c4c9cf");
  g.addColorStop(1, "#e3e6e9");
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 1.5;
  for (let k = -h; k < w; k += 7) {
    ctx.strokeStyle = k % 14 === 0 ? "#b7bcc3" : "#f6f7f8";
    ctx.beginPath();
    ctx.moveTo(x + k, y + h);
    ctx.lineTo(x + k + h, y);
    ctx.stroke();
  }
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = "#aab0b8";
  ctx.lineWidth = 1.2;
  const cx = x + w / 2;
  const cy = y + h / 2;
  for (let rr = 40; rr < w; rr += 22) {
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawFront(canvas, fonts) {
  const ctx = canvas.getContext("2d");
  const { sans, mono } = fonts;
  ctx.clearRect(0, 0, TEX_W, TEX_H);
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  ctx.fillStyle = INK;
  ctx.textBaseline = "alphabetic";
  ctx.font = `600 50px ${sans}`;
  ctx.textAlign = "left";
  ctx.fillText("herb.art", 72, 220);
  ctx.font = `460 40px ${sans}`;
  ctx.fillStyle = QUIET;
  ctx.textAlign = "right";
  ctx.fillText("Lab pass", TEX_W - 72, 220);

  foilBase(ctx);
  face(ctx, FOIL.x + FOIL.w / 2, FOIL.y + FOIL.h / 2, 380, "#0e0e10", "#f7f7f5");
  ctx.font = `500 30px ${mono}`;
  ctx.fillStyle = "#2a2c30";
  ctx.textAlign = "left";
  ctx.fillText("A-01", FOIL.x + 28, FOIL.y + FOIL.h - 30);
  ctx.textAlign = "right";
  ctx.fillText("2026", FOIL.x + FOIL.w - 28, FOIL.y + FOIL.h - 30);

  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.font = `600 232px ${sans}`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = "-9px";
  ctx.fillText("Herb", 60, 1118);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";

  ctx.font = `460 40px ${sans}`;
  ctx.fillStyle = INK;
  ctx.fillText("Herbart Hernandez", 72, 1184);
  ctx.fillStyle = QUIET;
  ctx.fillText("Design engineer, New York", 72, 1236);

  ctx.fillStyle = RULE;
  ctx.fillRect(72, 1284, TEX_W - 144, 2);

  barcode(ctx, 72, 1316, 470, 64, INK);
  ctx.font = `500 32px ${mono}`;
  ctx.textAlign = "right";
  ctx.fillStyle = INK;
  ctx.fillText("No. 0001", TEX_W - 72, 1342);
  ctx.fillStyle = QUIET;
  ctx.fillText("All rooms", TEX_W - 72, 1380);
  return canvas;
}

export function drawFrontSurface(canvas) {
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgb(0, 84, 0)";
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  const { x, y, w, h, r } = FOIL;
  roundRect(ctx, x, y, w, h, r);
  ctx.fillStyle = "rgb(255, 40, 255)";
  ctx.fill();
  const s = 380 / 64;
  ctx.save();
  ctx.translate(x + w / 2 - 32 * s, y + h / 2 - 32 * s);
  ctx.scale(s, s);
  ctx.strokeStyle = "rgb(0, 110, 0)";
  ctx.fillStyle = "rgb(0, 110, 0)";
  ctx.lineCap = "round";
  ctx.lineWidth = 4.2;
  ctx.beginPath();
  ctx.arc(32, 32, 28.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 3;
  for (const ex of [20, 44]) {
    ctx.beginPath();
    ctx.ellipse(ex, 26, 7.6, 9, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.arc(32, 41, 10, Math.PI * 0.1667, Math.PI * 0.8333);
  ctx.stroke();
  ctx.restore();
  return canvas;
}

export function drawBack(canvas, fonts) {
  const ctx = canvas.getContext("2d");
  const { sans, mono } = fonts;
  ctx.fillStyle = GROUND;
  ctx.fillRect(0, 0, TEX_W, TEX_H);

  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.fillStyle = INK;
  ctx.font = `600 64px ${sans}`;
  if ("letterSpacing" in ctx) ctx.letterSpacing = "-1.5px";
  ctx.fillText("Lab pass", 72, 262);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  ctx.font = `460 40px ${sans}`;
  ctx.fillStyle = QUIET;
  ctx.fillText("Admits one to every piece", 72, 324);
  ctx.fillText("in the lab, any day.", 72, 372);

  const top = 448;
  const row = 92;
  PIECES.forEach((title, i) => {
    const y = top + i * row;
    ctx.fillStyle = RULE;
    ctx.fillRect(72, y, TEX_W - 144, 2);
    ctx.font = `500 32px ${mono}`;
    ctx.fillStyle = QUIET;
    ctx.textAlign = "left";
    ctx.fillText(String(i + 1).padStart(2, "0"), 72, y + 58);
    ctx.font = `500 44px ${sans}`;
    ctx.fillStyle = INK;
    ctx.fillText(title, 172, y + 60);
  });
  ctx.fillStyle = RULE;
  ctx.fillRect(72, top + PIECES.length * row, TEX_W - 144, 2);

  face(ctx, TEX_W - 72 - 48, 1328, 96, INK, GROUND);
  ctx.font = `500 32px ${mono}`;
  ctx.fillStyle = INK;
  ctx.textAlign = "left";
  ctx.fillText("herb.art/lab", 72, 1316);
  ctx.fillStyle = QUIET;
  ctx.fillText("Keep this pass on you", 72, 1356);
  return canvas;
}

export function drawStrap(canvas, fonts) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  ctx.fillStyle = STRAP_COLOR;
  ctx.fillRect(0, 0, w, h);
  const rand = mulberry(9001);
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      const twill = ((x >> 1) + (y >> 1)) % 4 < 2;
      const v = (twill ? 0.06 : -0.05) + (rand() - 0.5) * 0.05;
      ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,20,${-v})`;
      ctx.fillRect(x, y, 2, 2);
    }
  }
  ctx.fillStyle = "rgba(0,0,30,0.28)";
  ctx.fillRect(0, 0, 5, h);
  ctx.fillRect(w - 5, 0, 5, h);
  ctx.fillStyle = "rgba(255,255,255,0.12)";
  ctx.fillRect(6, 0, 2, h);
  ctx.fillRect(w - 8, 0, 2, h);

  ctx.save();
  ctx.translate(w / 2, h);
  ctx.rotate(-Math.PI / 2);
  ctx.fillStyle = "#f6f6f2";
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = `600 ${Math.round(w * 0.46)}px ${fonts.sans}`;
  const word = "herb.art";
  const span = h / 2;
  const tw = ctx.measureText(word).width;
  for (let k = 0; k < 2; k += 1) {
    ctx.fillText(word, k * span + (span - tw) / 2, 2);
  }
  ctx.restore();
  return canvas;
}

export function drawWeave(canvas) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const img = ctx.createImageData(w, h);
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const phase = ((x + y) % 8) / 8;
      const ridge = 0.5 + 0.5 * Math.sin(phase * Math.PI * 2);
      const cross = 0.5 + 0.5 * Math.sin((y / 4) * Math.PI);
      const v = Math.round(255 * (0.25 + 0.5 * ridge * 0.8 + 0.25 * cross * 0.4));
      const o = (y * w + x) * 4;
      img.data[o] = v;
      img.data[o + 1] = v;
      img.data[o + 2] = v;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function drawFoilThickness(canvas) {
  const ctx = canvas.getContext("2d");
  const sx = canvas.width / TEX_W;
  const sy = canvas.height / TEX_H;
  const img = ctx.createImageData(canvas.width, canvas.height);
  const cx = (FOIL.x + FOIL.w / 2) * sx;
  const cy = (FOIL.y + FOIL.h / 2) * sy;
  for (let y = 0; y < canvas.height; y += 1) {
    for (let x = 0; x < canvas.width; x += 1) {
      const dx = (x - cx) / sx;
      const dy = (y - cy) / sy;
      const r = Math.hypot(dx, dy);
      const band = 0.5 + 0.5 * Math.sin(r / 70);
      const sweep = (dx * 0.7 - dy) / 1100 + 0.5;
      const v = Math.min(1, Math.max(0, 0.8 * sweep + 0.2 * band));
      const o = (y * canvas.width + x) * 4;
      img.data[o] = 0;
      img.data[o + 1] = Math.round(v * 255);
      img.data[o + 2] = 0;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}
