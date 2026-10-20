import { albumById } from "@/app/lab/_music/catalog";

export const ART_PX_PER_UNIT = 1800;
export const SLEEVE_PX = 1024;
export const SLEEVES = ["abbey-road", "revolver", "let-it-be", "help"].map((id) => albumById(id));

const BASE_STICKERS = [
  {
    id: "price",
    label: "Price sticker, $4.99",
    shape: "rect",
    kind: "price",
    w: 0.36,
    h: 0.2,
    x: 0.25,
    y: -0.31,
    angle: 0.06,
    adhesion: 1,
    tear: 0.85,
    gloss: 0.08,
    shine: 14,
    translucent: 0.11,
    backing: [0.97, 0.95, 0.9],
    rest: { corner: 2, peel: 0.1 },
  },
];

export function stickersFor(sleeveId) {
  const album = albumById(sleeveId) || SLEEVES[0];
  return BASE_STICKERS.map((def) => ({ ...def, title: album.title, artist: album.artist, label: `Price sticker, ${album.title}, $4.99` }));
}

function fitFont(ctx, text, weight, size, family, room) {
  let px = size;
  ctx.font = `${weight} ${Math.round(px)}px ${family}`;
  const width = ctx.measureText(text).width;
  if (width > room) {
    px *= room / width;
    ctx.font = `${weight} ${Math.round(px)}px ${family}`;
  }
  return px;
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

function drawPrice(ctx, w, h, fonts, def) {
  const pad = 2;
  const radius = h * 0.07;
  roundRectPath(ctx, pad, pad, w - pad * 2, h - pad * 2, radius);
  ctx.save();
  ctx.clip();
  const paper = ctx.createLinearGradient(0, 0, w, h);
  paper.addColorStop(0, "#f8f4ea");
  paper.addColorStop(0.5, "#f4efe2");
  paper.addColorStop(1, "#efe8d8");
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, w, h);
  const band = h * 0.3;
  ctx.fillStyle = "#c63a2c";
  ctx.fillRect(0, 0, w, band);
  ctx.fillStyle = "rgba(90,20,10,0.18)";
  ctx.fillRect(0, band - 2, w, 2);
  const inset = w * 0.065;
  const title = def.title || "Abbey Road";
  ctx.fillStyle = "#fbf3e6";
  ctx.textBaseline = "middle";
  ctx.textAlign = "right";
  const tagPx = fitFont(ctx, "Used LP", 500, band * 0.36, fonts.sans, w * 0.3);
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${(-0.005 * tagPx).toFixed(2)}px`;
  const tagW = ctx.measureText("Used LP").width;
  ctx.fillText("Used LP", w - inset, band * 0.55);
  ctx.textAlign = "left";
  const titlePx = fitFont(ctx, title, 600, band * 0.5, fonts.sans, w - inset * 2 - tagW - w * 0.05);
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${(-0.018 * titlePx).toFixed(2)}px`;
  ctx.fillText(title, inset, band * 0.54);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";

  ctx.save();
  ctx.filter = "blur(0.35px)";
  ctx.fillStyle = "rgba(40,40,52,0.78)";
  ctx.textBaseline = "alphabetic";
  const line = `${def.artist || "The Beatles"} · Very good +`;
  const linePx = fitFont(ctx, line, 500, h * 0.1, fonts.sans, w - inset * 2);
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${(0.004 * linePx).toFixed(2)}px`;
  ctx.fillText(line, inset, band + h * 0.135);
  if ("letterSpacing" in ctx) ctx.letterSpacing = "0px";
  ctx.restore();

  ctx.save();
  ctx.filter = "blur(0.6px)";
  ctx.fillStyle = "rgba(28,30,46,0.9)";
  ctx.font = `600 ${Math.round(h * 0.44)}px ${fonts.mono}`;
  ctx.textBaseline = "alphabetic";
  const glyphs = "$4.99".split("");
  const random = mulberry(41);
  const total = glyphs.reduce((acc, g) => acc + ctx.measureText(g).width * (g === "." ? 0.5 : 0.96), 0);
  let x = w - inset - total;
  for (const glyph of glyphs) {
    const jitter = (random() - 0.5) * h * 0.018;
    const advance = ctx.measureText(glyph).width;
    const dot = glyph === ".";
    ctx.globalAlpha = 0.82 + random() * 0.18;
    ctx.fillText(glyph, x - (dot ? advance * 0.24 : 0), h * 0.86 + jitter);
    x += advance * (dot ? 0.5 : 0.96);
  }
  ctx.restore();

  speckle(ctx, w, h, 7, 0.005);
  fibres(ctx, w, h, 9, 260, "#7a6a50");
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
  drawPrice(ctx, w, h, fonts, def);
  return canvas;
}

function ringWear(ctx, size, seed) {
  const random = mulberry(seed);
  const cx = size * 0.5;
  const cy = size * 0.5;
  const r = size * 0.462;
  ctx.save();
  ctx.lineCap = "round";
  for (let i = 0; i < 90; i += 1) {
    const a0 = random() * Math.PI * 2;
    const span = 0.08 + random() * 0.32;
    const rr = r + (random() - 0.5) * size * 0.012;
    ctx.strokeStyle = `rgba(255,250,238,${0.03 + random() * 0.07})`;
    ctx.lineWidth = size * (0.006 + random() * 0.016);
    ctx.beginPath();
    ctx.arc(cx, cy, rr, a0, a0 + span);
    ctx.stroke();
  }
  ctx.strokeStyle = "rgba(255,250,238,0.05)";
  ctx.lineWidth = size * 0.02;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.17, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function edgeWear(ctx, size, seed) {
  const random = mulberry(seed);
  ctx.save();
  for (let i = 0; i < 320; i += 1) {
    const side = Math.floor(random() * 4);
    const t = random();
    const corner = Math.pow(Math.abs(t - 0.5) * 2, 6);
    const depth = size * (0.001 + random() * 0.003 + corner * 0.012);
    const along = t * size;
    const len = size * (0.004 + random() * 0.02);
    ctx.fillStyle = `rgba(255,252,244,${0.04 + random() * 0.12 + corner * 0.26})`;
    if (side === 0) ctx.fillRect(along, 0, len, depth);
    else if (side === 1) ctx.fillRect(along, size - depth, len, depth);
    else if (side === 2) ctx.fillRect(0, along, depth, len);
    else ctx.fillRect(size - depth, along, depth, len);
  }
  ctx.restore();
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
  ctx.filter = "contrast(1.03) saturate(0.92)";
  ctx.drawImage(photo, sx, sy, side, side, 0, 0, size, size);
  ctx.filter = "none";
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = "#f7f1e6";
  ctx.fillRect(0, 0, size, size);
  ctx.globalCompositeOperation = "source-over";
  const wear = document.createElement("canvas");
  wear.width = size;
  wear.height = size;
  const wctx = wear.getContext("2d");
  ringWear(wctx, size, 53);
  const edges = document.createElement("canvas");
  edges.width = size;
  edges.height = size;
  edgeWear(edges.getContext("2d"), size, 61);
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.filter = `blur(${Math.round(size * 0.006)}px)`;
  ctx.drawImage(wear, 0, 0);
  ctx.filter = "blur(1.2px)";
  ctx.drawImage(edges, 0, 0);
  ctx.restore();
  speckle(ctx, size, size, 31, 0.0016);
  fibres(ctx, size, size, 37, 900, "#efe6d2");
  return canvas;
}

export function shapeContains(def, lx, ly) {
  const a = def.w / 2;
  const b = def.h / 2;
  if (def.shape === "rect") return Math.abs(lx) <= a && Math.abs(ly) <= b;
  return (lx * lx) / (a * a) + (ly * ly) / (b * b) <= 1;
}
