import { albumById } from "@/app/lab/_music/catalog";

export const ART_PX_PER_UNIT = 1800;
export const SLEEVE_PX = 1024;
export const SLEEVES = ["abbey-road", "revolver", "let-it-be", "help"].map((id) => albumById(id));
const STICKER_POOL = ["revolver", "rubber-soul", "sgt-pepper", "abbey-road", "magical-mystery-tour"];

const BASE_STICKERS = [
  {
    id: "square",
    shape: "rect",
    kind: "square",
    w: 0.25,
    h: 0.25,
    x: -0.29,
    y: -0.3,
    angle: -0.12,
    adhesion: 0.5,
    tear: 0.05,
    gloss: 0.55,
    shine: 70,
    translucent: 0.04,
    backing: [0.95, 0.95, 0.93],
  },
  {
    id: "round",
    shape: "circle",
    w: 0.21,
    h: 0.21,
    x: 0.33,
    y: -0.34,
    angle: 0.22,
    adhesion: 0.78,
    tear: 0.35,
    gloss: 0.18,
    shine: 24,
    translucent: 0.08,
    backing: [0.97, 0.96, 0.92],
  },
  {
    id: "oval",
    shape: "ellipse",
    w: 0.3,
    h: 0.18,
    x: -0.3,
    y: 0.39,
    angle: -0.08,
    adhesion: 0.6,
    tear: 0.12,
    gloss: 0.45,
    shine: 56,
    translucent: 0.05,
    backing: [0.95, 0.95, 0.93],
  },
  {
    id: "price",
    label: "Price sticker, $4.99",
    shape: "rect",
    kind: "price",
    w: 0.3,
    h: 0.165,
    x: 0.31,
    y: 0.4,
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

export function stickersFor(sleeveId) {
  const pool = STICKER_POOL.filter((id) => id !== sleeveId).map((id) => albumById(id));
  let next = 0;
  return BASE_STICKERS.map((def) => {
    if (def.kind === "price") return def;
    const album = pool[next % pool.length];
    next += 1;
    const short = album.title.startsWith("Sgt.") ? "Sgt. Pepper" : album.title;
    return { ...def, cover: album.cover, label: `${short} sticker` };
  });
}

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
  ctx.fillText("Used LP", w * 0.06, band * 0.52);
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

function drawCover(ctx, image, x, y, w, h) {
  const iw = image.naturalWidth;
  const ih = image.naturalHeight;
  const scale = Math.max(w / iw, h / ih);
  const sw = w / scale;
  const sh = h / scale;
  ctx.drawImage(image, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}

function shapePath(ctx, def, w, h, inset) {
  ctx.beginPath();
  if (def.shape === "circle" || def.shape === "ellipse") ctx.ellipse(w / 2, h / 2, w / 2 - inset, h / 2 - inset, 0, 0, Math.PI * 2);
  else roundRectPath(ctx, inset, inset, w - inset * 2, h - inset * 2, Math.min(w, h) * 0.05);
}

function drawCoverSticker(ctx, def, image, w, h, seed) {
  const rim = Math.min(w, h) * (def.shape === "rect" ? 0.06 : 0.05);
  shapePath(ctx, def, w, h, 2);
  ctx.save();
  ctx.clip();
  ctx.fillStyle = "#f6f3ec";
  ctx.fillRect(0, 0, w, h);
  shapePath(ctx, def, w, h, 2 + rim);
  ctx.save();
  ctx.clip();
  if (image) drawCover(ctx, image, rim, rim, w - rim * 2, h - rim * 2);
  ctx.restore();
  ctx.strokeStyle = "rgba(0,0,0,0.12)";
  ctx.lineWidth = 1.5;
  shapePath(ctx, def, w, h, 2 + rim);
  ctx.stroke();
  speckle(ctx, w, h, seed, 0.003);
  fibres(ctx, w, h, seed + 4, 60, "#7a6a50");
  ctx.restore();
}

export function stickerArt(def, fonts, dpr, image) {
  const scale = ART_PX_PER_UNIT * Math.min(1, Math.max(0.6, dpr / 2));
  const w = Math.round(def.w * scale);
  const h = Math.round(def.h * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (def.kind === "price") drawPrice(ctx, w, h, fonts);
  else drawCoverSticker(ctx, def, image, w, h, def.id.length * 7 + 3);
  return canvas;
}

export function sleeveArt(photo) {
  const size = SLEEVE_PX;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  const side = Math.min(photo.naturalWidth, photo.naturalHeight);
  const sx = (photo.naturalWidth - side) / 2;
  const sy = (photo.naturalHeight - side) / 2;
  ctx.filter = "contrast(1.04) saturate(0.94)";
  ctx.drawImage(photo, sx, sy, side, side, 0, 0, size, size);
  ctx.filter = "none";
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = "#f7f1e6";
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = "source-over";
  speckle(ctx, size, size, 31, 0.0016);
  return canvas;
}

export function shapeContains(def, lx, ly) {
  const a = def.w / 2;
  const b = def.h / 2;
  if (def.shape === "rect") return Math.abs(lx) <= a && Math.abs(ly) <= b;
  return (lx * lx) / (a * a) + (ly * ly) / (b * b) <= 1;
}
