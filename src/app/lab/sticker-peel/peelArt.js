export const ART_PX_PER_UNIT = 1800;
export const SLEEVE_PX = 1024;
export const SLEEVE_PHOTO = "/monovolt/abt1.webp";

export const STICKERS = [
  {
    id: "shop",
    label: "Slow Orbit Records shop sticker",
    shape: "ellipse",
    w: 0.44,
    h: 0.24,
    x: -0.235,
    y: 0.325,
    angle: -0.08,
    adhesion: 0.5,
    tear: 0.05,
    gloss: 0.55,
    shine: 70,
    translucent: 0.05,
    backing: [0.95, 0.95, 0.93],
  },
  {
    id: "used",
    label: "Used sticker",
    shape: "circle",
    w: 0.19,
    h: 0.19,
    x: 0.335,
    y: -0.365,
    angle: 0.22,
    adhesion: 0.78,
    tear: 0.35,
    gloss: 0.1,
    shine: 16,
    translucent: 0.1,
    backing: [0.97, 0.96, 0.92],
  },
  {
    id: "price",
    label: "Price sticker, $4.99",
    shape: "rect",
    w: 0.4,
    h: 0.22,
    x: 0.24,
    y: -0.12,
    angle: 0.05,
    adhesion: 1,
    tear: 0.85,
    gloss: 0.08,
    shine: 14,
    translucent: 0.11,
    backing: [0.97, 0.95, 0.9],
    rest: { corner: 2, peel: 0.08 },
  },
];

function mulberry(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fontStack(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export async function readyFonts() {
  const sans = fontStack("--font-sans", "ui-sans-serif, system-ui, sans-serif");
  const mono = fontStack("--font-mono", "ui-monospace, Menlo, monospace");
  try {
    await Promise.all([
      document.fonts.load(`600 40px ${sans}`),
      document.fonts.load(`500 40px ${sans}`),
      document.fonts.load(`600 40px ${mono}`),
    ]);
  } catch {}
  return { sans, mono, serif: "Georgia, 'Times New Roman', serif" };
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

function speckle(ctx, width, height, seed, amount, clip) {
  const random = mulberry(seed);
  const count = Math.round(width * height * amount);
  for (let i = 0; i < count; i += 1) {
    const x = random() * width;
    const y = random() * height;
    if (clip && !clip(x, y)) continue;
    const light = random() > 0.5;
    ctx.fillStyle = light ? `rgba(255,255,255,${0.05 + random() * 0.12})` : `rgba(40,30,20,${0.03 + random() * 0.08})`;
    const size = 0.6 + random() * 1.6;
    ctx.fillRect(x, y, size, size);
  }
}

function fibres(ctx, width, height, seed, count, color) {
  const random = mulberry(seed);
  ctx.save();
  ctx.lineCap = "round";
  for (let i = 0; i < count; i += 1) {
    const x = random() * width;
    const y = random() * height;
    const len = 4 + random() * 14;
    const a = random() * Math.PI;
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.04 + random() * 0.08;
    ctx.lineWidth = 0.5 + random() * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a) * len * 0.5 + (random() - 0.5) * 4, y + Math.sin(a) * len * 0.5 + (random() - 0.5) * 4, x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.restore();
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawPrice(ctx, w, h, fonts) {
  const pad = 2;
  const radius = h * 0.06;
  roundRectPath(ctx, pad, pad, w - pad * 2, h - pad * 2, radius);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = "#f3eee0";
  ctx.fillRect(0, 0, w, h);
  const band = h * 0.32;
  ctx.fillStyle = "#c8352d";
  ctx.fillRect(0, 0, w, band);
  ctx.fillStyle = "rgba(255,255,255,0.08)";
  ctx.fillRect(0, band - 3, w, 3);
  ctx.fillStyle = "#fbf3e6";
  ctx.font = `600 ${Math.round(band * 0.4)}px ${fonts.sans}`;
  ctx.textBaseline = "middle";
  ctx.fillText("Slow Orbit Records", w * 0.06, band * 0.52);
  ctx.font = `italic ${Math.round(band * 0.34)}px ${fonts.serif}`;
  ctx.textAlign = "right";
  ctx.fillText("2207", w * 0.95, band * 0.54);
  ctx.textAlign = "left";

  ctx.strokeStyle = "#2a2b34";
  ctx.lineWidth = 3;
  const tagX = w * 0.06;
  const tagY = band + h * 0.12;
  ctx.strokeRect(tagX, tagY, h * 0.24, h * 0.16);
  ctx.fillStyle = "#2a2b34";
  ctx.font = `600 ${Math.round(h * 0.11)}px ${fonts.sans}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.fillText("LP", tagX + h * 0.12, tagY + h * 0.085);
  ctx.font = `500 ${Math.round(h * 0.095)}px ${fonts.sans}`;
  ctx.fillText("VG+", tagX + h * 0.12, tagY + h * 0.3);
  ctx.textAlign = "left";

  ctx.save();
  ctx.filter = "blur(0.7px)";
  ctx.fillStyle = "rgba(24,26,40,0.92)";
  ctx.font = `600 ${Math.round(h * 0.4)}px ${fonts.mono}`;
  ctx.textBaseline = "alphabetic";
  const glyphs = "$4.99".split("");
  const random = mulberry(41);
  let x = w * 0.31;
  for (const glyph of glyphs) {
    const jitter = (random() - 0.5) * h * 0.02;
    const advance = ctx.measureText(glyph).width;
    const dot = glyph === ".";
    ctx.fillText(glyph, x - (dot ? advance * 0.24 : 0), h * 0.86 + jitter);
    x += advance * (dot ? 0.5 : 0.96);
  }
  ctx.restore();

  ctx.strokeStyle = "rgba(255,255,255,0.75)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(w * 0.9, h * 0.6);
  ctx.lineTo(w * 0.96, h * 0.72);
  ctx.moveTo(w * 0.04, h * 0.88);
  ctx.lineTo(w * 0.1, h * 0.98);
  ctx.stroke();
  speckle(ctx, w, h, 7, 0.006);
  fibres(ctx, w, h, 9, 220, "#7a6a50");
  ctx.restore();
}

function drawUsed(ctx, w, h, fonts) {
  const cx = w / 2;
  const cy = h / 2;
  const r = w / 2 - 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
  g.addColorStop(0, "#ff7a3d");
  g.addColorStop(0.55, "#ff6a2e");
  g.addColorStop(1, "#f45d26");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "rgba(120,30,0,0.32)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx + 1.5, cy + 1, r * 0.84, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#1d1714";
  ctx.font = `600 ${Math.round(r * 0.56)}px ${fonts.sans}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Used", cx + 2, cy + r * 0.04);
  speckle(ctx, w, h, 13, 0.01);
  fibres(ctx, w, h, 17, 90, "#7a2a00");
  ctx.restore();
}

function drawShop(ctx, w, h, fonts) {
  const cx = w / 2;
  const cy = h / 2;
  const rx = w / 2 - 2;
  const ry = h / 2 - 2;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.clip();
  const g = ctx.createLinearGradient(0, 0, w, h);
  g.addColorStop(0, "#1f4434");
  g.addColorStop(0.5, "#1a3a2d");
  g.addColorStop(1, "#163226");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#ece2c8";
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx - 16, ry - 16, 0, 0, Math.PI * 2);
  ctx.stroke();

  const ix = w * 0.22;
  const iy = cy;
  ctx.fillStyle = "#ece2c8";
  ctx.beginPath();
  ctx.arc(ix, iy, h * 0.13, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#1a3a2d";
  ctx.beginPath();
  ctx.arc(ix, iy, h * 0.045, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#e9a23b";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.ellipse(ix, iy, h * 0.24, h * 0.075, -0.45, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = "#ece2c8";
  ctx.textBaseline = "alphabetic";
  ctx.font = `italic ${Math.round(h * 0.25)}px ${fonts.serif}`;
  const title = "Slow Orbit";
  const room = w * 0.5;
  const measured = ctx.measureText(title).width;
  if (measured > room) ctx.font = `italic ${Math.round(h * 0.25 * (room / measured))}px ${fonts.serif}`;
  ctx.fillText(title, w * 0.37, cy + h * 0.03);
  ctx.font = `500 ${Math.round(h * 0.088)}px ${fonts.sans}`;
  ctx.fillText("Records  ·  41 Canal St", w * 0.385, cy + h * 0.2);
  speckle(ctx, w, h, 23, 0.002);
  ctx.restore();
}

export function stickerArt(def, fonts, dpr) {
  const scale = ART_PX_PER_UNIT * Math.min(1, Math.max(0.6, dpr / 2));
  const w = Math.round(def.w * scale);
  const h = Math.round(def.h * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (def.shape === "rect") drawPrice(ctx, w, h, fonts);
  else if (def.shape === "circle") drawUsed(ctx, w, h, fonts);
  else drawShop(ctx, w, h, fonts);
  return canvas;
}

export function sleeveArt(photo, fonts) {
  const size = SLEEVE_PX;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const side = Math.min(photo.naturalWidth, photo.naturalHeight);
  const sx = (photo.naturalWidth - side) / 2;
  const sy = (photo.naturalHeight - side) * 0.35;
  ctx.filter = "contrast(1.1) brightness(0.96)";
  ctx.drawImage(photo, sx, sy, side, side, 0, 0, size, size);
  ctx.filter = "none";
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = "#f4ede0";
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = "source-over";
  const shade = ctx.createLinearGradient(0, 0, 0, size * 0.32);
  shade.addColorStop(0, "rgba(10,9,8,0.42)");
  shade.addColorStop(0.45, "rgba(10,9,8,0.2)");
  shade.addColorStop(1, "rgba(10,9,8,0)");
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, size, size * 0.32);
  ctx.fillStyle = "#f1ece2";
  ctx.textBaseline = "alphabetic";
  ctx.font = `600 ${Math.round(size * 0.066)}px ${fonts.sans}`;
  ctx.fillText("Monovolt", size * 0.055, size * 0.11);
  ctx.font = `italic ${Math.round(size * 0.038)}px ${fonts.serif}`;
  ctx.fillText("Live at Basement Nine", size * 0.058, size * 0.158);
  ctx.font = `500 ${Math.round(size * 0.02)}px ${fonts.mono}`;
  ctx.textAlign = "right";
  ctx.fillText("MV-012  ·  Stereo", size * 0.95, size * 0.955);
  ctx.textAlign = "left";
  return canvas;
}

export function shapeContains(def, lx, ly) {
  const a = def.w / 2;
  const b = def.h / 2;
  if (def.shape === "rect") return Math.abs(lx) <= a && Math.abs(ly) <= b;
  return (lx * lx) / (a * a) + (ly * ly) / (b * b) <= 1;
}
