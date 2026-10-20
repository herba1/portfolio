import k01 from "./film/kodim01.jpg";
import k02 from "./film/kodim02.jpg";
import k06 from "./film/kodim06.jpg";
import k07 from "./film/kodim07.jpg";
import k08 from "./film/kodim08.jpg";
import k09 from "./film/kodim09.jpg";
import k11 from "./film/kodim11.jpg";
import k12 from "./film/kodim12.jpg";
import k13 from "./film/kodim13.jpg";
import k14 from "./film/kodim14.jpg";
import k15 from "./film/kodim15.jpg";
import k16 from "./film/kodim16.jpg";
import k17 from "./film/kodim17.jpg";
import k20 from "./film/kodim20.jpg";
import k21 from "./film/kodim21.jpg";
import k22 from "./film/kodim22.jpg";
import k23 from "./film/kodim23.jpg";
import k24 from "./film/kodim24.jpg";

export const TEXEL_MM = 11;
export const ATLAS_W = 4096;
export const ATLAS_H = 2048;
export const LOUPE_R = 21;
export const LOUPE_MAG = 3.6;

const MF_FRAME = 56;
const MF_PITCH = 62;
const MF_FILM = 62;
const MASK = 66;
const MOUNT = 50;
const NEG_PITCH = 38;
const NEG_FILM = 35;

const KIND_CODE = { mask: 0, mount: 1, negative: 2, strip: 3, paper: 4 };

export const PIECES = [
  { key: "contact", kind: "paper", seed: 0.17, at: [8, 8], w: 128, h: 122, frames: [k01, k08, k24, k13, k21, k02, k07, k23, k15].map((i) => i.src) },
  { key: "roll", kind: "strip", seed: 0.31, at: [1424, 8], w: 2 * MF_PITCH + 4, h: MF_FILM, frames: [k14, k20].map((i) => i.src) },
  { key: "statue", kind: "mask", seed: 0.84, at: [2840, 8], w: MASK, h: MASK, src: k17.src, win: [MF_FRAME / 2, MF_FRAME / 2] },
  { key: "barn", kind: "mount", seed: 0.52, at: [1424, 698], w: MOUNT, h: MOUNT, src: k22.src, win: [17.5, 11.5], number: "14" },
  { key: "regatta", kind: "mount", seed: 0.66, at: [1982, 698], w: MOUNT, h: MOUNT, src: k09.src, win: [11.5, 17.5], number: "22" },
  { key: "beach", kind: "negative", seed: 0.21, at: [1424, 1256], w: 4 * NEG_PITCH + 6, h: NEG_FILM, frames: [k12, k06, k11, k16].map((i) => i.src) },
  { key: "label", kind: "paper", seed: 0.47, at: [8, 1358], w: 54, h: 13, text: "Roll 12, the coast" },
];

for (const piece of PIECES) {
  piece.code = KIND_CODE[piece.kind];
  piece.win = piece.win || [0, 0];
  piece.px = [Math.round(piece.w * TEXEL_MM), Math.round(piece.h * TEXEL_MM)];
  piece.rect = [
    piece.at[0] / ATLAS_W,
    piece.at[1] / ATLAS_H,
    (piece.at[0] + piece.px[0]) / ATLAS_W,
    (piece.at[1] + piece.px[1]) / ATLAS_H,
  ];
}

export const LAYOUTS = [
  {
    key: "wide",
    box: [0, 0, 336, 196],
    pieces: {
      contact: [70, 68, -2.4],
      roll: [214, 40, 1.2],
      beach: [218, 104, -1.6],
      statue: [298, 156, 3.4],
      barn: [158, 160, -5],
      regatta: [222, 166, 4],
      label: [108, 130, -3.5],
    },
    loupe: [223, 165],
  },
  {
    key: "tall",
    box: [0, 0, 186, 322],
    pieces: {
      contact: [68, 64, -2],
      roll: [80, 206, 1.5],
      beach: [94, 148, -1.4],
      statue: [148, 286, 3],
      barn: [38, 276, -5],
      regatta: [94, 290, 4],
      label: [160, 44, 88],
    },
    loupe: [38, 274],
  },
];

function rng(seed) {
  let a = Math.floor(seed * 4294967296) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${src}`));
    img.src = src;
  });
}

let monoFamily = null;

async function mono() {
  if (monoFamily) return monoFamily;
  const probe = document.createElement("span");
  probe.style.fontFamily = "var(--font-mono)";
  document.body.appendChild(probe);
  monoFamily = getComputedStyle(probe).fontFamily || "monospace";
  probe.remove();
  try {
    await document.fonts.load(`500 24px ${monoFamily}`);
  } catch {}
  return monoFamily;
}

function canvas2d(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c.getContext("2d", { willReadFrequently: true });
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
}

function drawCover(ctx, img, x, y, w, h) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const s = Math.max(w / iw, h / ih);
  const sw = w / s;
  const sh = h / s;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}

function grade(ctx, x, y, w, h) {
  const data = ctx.getImageData(x, y, w, h);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] / 255;
    let g = d[i + 1] / 255;
    let b = d[i + 2] / 255;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    r = l + (r - l) * 1.16;
    g = l + (g - l) * 1.16;
    b = l + (b - l) * 1.16;
    const curve = (v) => {
      const c = Math.min(1, Math.max(0, v));
      return c + (c * c * (3 - 2 * c) - c) * 0.36;
    };
    d[i] = curve(r) * 255;
    d[i + 1] = curve(g) * 255;
    d[i + 2] = curve(b) * 255;
  }
  ctx.putImageData(data, x, y);
}

function speckle(ctx, w, h, seed, amount) {
  const rand = rng(seed);
  const data = ctx.getImageData(0, 0, w, h);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * amount;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(data, 0, 0);
}

function opaqueAlpha(w, h, radius, holes) {
  const m = canvas2d(w, h);
  m.fillStyle = "rgb(0,0,0)";
  m.fillRect(0, 0, w, h);
  m.fillStyle = "rgb(128,128,128)";
  roundRect(m, 0, 0, w, h, radius);
  m.fill();
  if (holes) {
    m.fillStyle = "rgb(255,255,255)";
    holes(m);
  }
  return m;
}

function buildMask(piece, img) {
  const [w, h] = piece.px;
  const k = TEXEL_MM;
  const ctx = canvas2d(w, h);
  const win = MF_FRAME * k;
  const wx = (w - win) / 2;
  const wy = (h - win) / 2;
  ctx.fillStyle = "rgb(20, 20, 22)";
  ctx.fillRect(0, 0, w, h);
  speckle(ctx, w, h, piece.seed, 5);
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 0.3 * k;
  roundRect(ctx, wx - 0.8 * k, wy - 0.8 * k, win + 1.6 * k, win + 1.6 * k, 0.8 * k);
  ctx.stroke();
  ctx.save();
  roundRect(ctx, wx, wy, win, win, 0.5 * k);
  ctx.clip();
  drawCover(ctx, img, wx, wy, win, win);
  ctx.restore();
  grade(ctx, Math.floor(wx), Math.floor(wy), Math.ceil(win), Math.ceil(win));
  const mask = opaqueAlpha(w, h, 1.6 * k, (m) => {
    roundRect(m, wx, wy, win, win, 0.5 * k);
    m.fill();
  });
  return { color: ctx, mask };
}

function buildMount(piece, img, family) {
  const [w, h] = piece.px;
  const k = TEXEL_MM;
  const ctx = canvas2d(w, h);
  const ww = piece.win[0] * 2 * k;
  const wh = piece.win[1] * 2 * k;
  const wx = (w - ww) / 2;
  const wy = (h - wh) / 2;
  ctx.fillStyle = "rgb(226, 223, 216)";
  ctx.fillRect(0, 0, w, h);
  speckle(ctx, w, h, piece.seed, 7);
  ctx.strokeStyle = "rgba(0,0,0,0.08)";
  ctx.lineWidth = 0.35 * k;
  roundRect(ctx, wx - 2.2 * k, wy - 2.2 * k, ww + 4.4 * k, wh + 4.4 * k, 1.6 * k);
  ctx.stroke();
  ctx.fillStyle = "rgba(0,0,0,0.05)";
  roundRect(ctx, 1.4 * k, 1.4 * k, w - 2.8 * k, h - 2.8 * k, 1.8 * k);
  ctx.fill();
  ctx.fillStyle = "rgb(226, 223, 216)";
  roundRect(ctx, 1.8 * k, 1.8 * k, w - 3.6 * k, h - 3.6 * k, 1.6 * k);
  ctx.fill();
  ctx.fillStyle = "rgb(70, 66, 60)";
  ctx.font = `500 ${2.6 * k}px ${family}`;
  ctx.textBaseline = "alphabetic";
  const portrait = piece.win[1] > piece.win[0];
  if (portrait) {
    ctx.save();
    ctx.translate(w - 4.6 * k, h / 2);
    ctx.rotate(Math.PI / 2);
    ctx.textAlign = "center";
    ctx.fillText(piece.number, 0, 0);
    ctx.restore();
  } else {
    ctx.textAlign = "center";
    ctx.fillText(piece.number, w / 2, h - 3.2 * k);
  }
  ctx.save();
  roundRect(ctx, wx, wy, ww, wh, 0.4 * k);
  ctx.clip();
  drawCover(ctx, img, wx, wy, ww, wh);
  ctx.restore();
  grade(ctx, Math.floor(wx), Math.floor(wy), Math.ceil(ww), Math.ceil(wh));
  const mask = opaqueAlpha(w, h, 2.2 * k, (m) => {
    roundRect(m, wx, wy, ww, wh, 0.4 * k);
    m.fill();
  });
  return { color: ctx, mask };
}

function buildStrip(piece, images) {
  const [w, h] = piece.px;
  const k = TEXEL_MM;
  const ctx = canvas2d(w, h);
  ctx.fillStyle = "rgb(9, 8, 8)";
  ctx.fillRect(0, 0, w, h);
  const fy = ((MF_FILM - MF_FRAME) / 2) * k;
  images.forEach((img, i) => {
    const fx = (2 + 3 + i * MF_PITCH) * k;
    ctx.save();
    roundRect(ctx, fx, fy, MF_FRAME * k, MF_FRAME * k, 0.4 * k);
    ctx.clip();
    drawCover(ctx, img, fx, fy, MF_FRAME * k, MF_FRAME * k);
    ctx.restore();
    grade(ctx, Math.floor(fx), Math.floor(fy), Math.ceil(MF_FRAME * k), Math.ceil(MF_FRAME * k));
  });
  const mask = canvas2d(w, h);
  mask.fillStyle = "rgb(0,0,0)";
  mask.fillRect(0, 0, w, h);
  mask.fillStyle = "rgb(255,255,255)";
  roundRect(mask, 0, 0, w, h, 0.5 * k);
  mask.fill();
  return { color: ctx, mask };
}

function sprockets(ctx, w, h, k, fill) {
  const pitch = 4.75 * k;
  const hw = 1.98 * k;
  const hh = 2.8 * k;
  ctx.fillStyle = fill;
  for (let x = 1.6 * k; x + hw < w; x += pitch) {
    roundRect(ctx, x, 1.1 * k, hw, hh, 0.5 * k);
    ctx.fill();
    roundRect(ctx, x, h - 1.1 * k - hh, hw, hh, 0.5 * k);
    ctx.fill();
  }
}

function buildNegative(piece, images, family) {
  const [w, h] = piece.px;
  const k = TEXEL_MM;
  const ctx = canvas2d(w, h);
  ctx.fillStyle = "rgb(10, 10, 10)";
  ctx.fillRect(0, 0, w, h);
  const fw = 36 * k;
  const fh = 24 * k;
  const fy = (h - fh) / 2;
  images.forEach((img, i) => {
    const fx = (4 + i * NEG_PITCH) * k;
    ctx.save();
    roundRect(ctx, fx, fy, fw, fh, 0.6 * k);
    ctx.clip();
    drawCover(ctx, img, fx, fy, fw, fh);
    ctx.restore();
  });
  const data = ctx.getImageData(0, 0, w, h);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = Math.min(255, 10 + d[i] * 0.86);
    d[i + 1] = Math.min(255, 10 + d[i + 1] * 0.86);
    d[i + 2] = Math.min(255, 10 + d[i + 2] * 0.86);
  }
  ctx.putImageData(data, 0, 0);
  ctx.fillStyle = "rgb(150, 150, 150)";
  ctx.font = `500 ${2 * k}px ${family}`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  images.forEach((_, i) => {
    const cx = (4 + i * NEG_PITCH + 18) * k;
    ctx.fillText(`${12 + i}`, cx - 8 * k, h - 5.2 * k);
    ctx.fillText(`▸ ${12 + i}A`, cx + 8 * k, h - 5.2 * k);
  });
  const mask = canvas2d(w, h);
  mask.fillStyle = "rgb(0,0,0)";
  mask.fillRect(0, 0, w, h);
  mask.fillStyle = "rgb(255,255,255)";
  mask.fillRect(0, 0, w, h);
  sprockets(mask, w, h, k, "rgb(0,0,0)");
  return { color: ctx, mask };
}

function greasePencil(ctx, cx, cy, rx, ry, k, seed) {
  const rand = rng(seed);
  ctx.save();
  ctx.strokeStyle = "rgba(196, 38, 30, 0.86)";
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (let pass = 0; pass < 3; pass += 1) {
    ctx.lineWidth = (0.7 + rand() * 0.3) * k;
    ctx.beginPath();
    const start = -0.4 + rand() * 0.2;
    const sweep = Math.PI * 2.12;
    for (let s = 0; s <= 80; s += 1) {
      const t = start + (s / 80) * sweep;
      const wob = 1 + (rand() - 0.5) * 0.02 + 0.04 * Math.sin(t * 3 + pass);
      const x = cx + Math.cos(t) * rx * wob;
      const y = cy + Math.sin(t) * ry * wob;
      if (s === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.globalAlpha = pass === 0 ? 1 : 0.35;
    ctx.stroke();
  }
  ctx.restore();
}

function greaseCross(ctx, cx, cy, r, k) {
  ctx.save();
  ctx.strokeStyle = "rgba(196, 38, 30, 0.82)";
  ctx.lineWidth = 0.8 * k;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(cx - r, cy - r * 0.9);
  ctx.quadraticCurveTo(cx, cy + r * 0.1, cx + r * 1.05, cy + r);
  ctx.moveTo(cx + r * 0.95, cy - r);
  ctx.quadraticCurveTo(cx + r * 0.1, cy, cx - r * 0.9, cy + r * 0.95);
  ctx.stroke();
  ctx.restore();
}

function toGray(ctx, x, y, w, h) {
  const data = ctx.getImageData(x, y, w, h);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / 255;
    const c = Math.min(1, Math.max(0, (l - 0.04) * 1.12));
    const v = 255 * (c + (c * c * (3 - 2 * c) - c) * 0.5);
    d[i] = v * 0.99;
    d[i + 1] = v * 0.975;
    d[i + 2] = v * 0.94;
  }
  ctx.putImageData(data, x, y);
}

function buildContact(piece, images, family) {
  const [w, h] = piece.px;
  const k = TEXEL_MM;
  const ctx = canvas2d(w, h);
  ctx.fillStyle = "rgb(240, 236, 226)";
  ctx.fillRect(0, 0, w, h);
  const border = 5 * k;
  ctx.fillStyle = "rgb(18, 17, 16)";
  ctx.fillRect(border, border, w - border * 2, h - border * 2);
  const stripH = NEG_FILM * k;
  const gap = (h - border * 2 - stripH * 3) / 4;
  for (let row = 0; row < 3; row += 1) {
    const sy = border + gap + row * (stripH + gap);
    const sx = border + 2 * k;
    const sw = w - border * 2 - 4 * k;
    ctx.fillStyle = "rgb(28, 27, 25)";
    ctx.fillRect(sx, sy, sw, stripH);
    ctx.save();
    ctx.translate(sx, sy);
    sprockets(ctx, sw, stripH, k, "rgb(12, 12, 11)");
    ctx.restore();
    for (let col = 0; col < 3; col += 1) {
      const img = images[row * 3 + col];
      const fx = sx + (1.5 + col * NEG_PITCH) * k;
      const fy = sy + (stripH - 24 * k) / 2;
      ctx.save();
      roundRect(ctx, fx, fy, 36 * k, 24 * k, 0.6 * k);
      ctx.clip();
      drawCover(ctx, img, fx, fy, 36 * k, 24 * k);
      ctx.restore();
      ctx.fillStyle = "rgb(214, 210, 200)";
      ctx.font = `500 ${1.8 * k}px ${family}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`${row * 3 + col + 1}`, fx + 18 * k, sy + stripH - 2.4 * k);
    }
  }
  toGray(ctx, 0, 0, w, h);
  speckle(ctx, w, h, piece.seed, 4);
  const frameCenter = (row, col) => {
    const sy = border + gap + row * (stripH + gap);
    const sx = border + 2 * k;
    return [sx + (1.5 + col * NEG_PITCH + 18) * k, sy + stripH / 2];
  };
  const [cx, cy] = frameCenter(0, 2);
  greasePencil(ctx, cx, cy, 21 * k, 15 * k, k, piece.seed);
  const [xx, xy] = frameCenter(1, 0);
  greaseCross(ctx, xx, xy, 6 * k, k);
  const mask = opaqueAlpha(w, h, 0.6 * k);
  return { color: ctx, mask };
}

function buildLabel(piece, family) {
  const [w, h] = piece.px;
  const k = TEXEL_MM;
  const ctx = canvas2d(w, h);
  ctx.fillStyle = "rgb(243, 238, 222)";
  ctx.fillRect(0, 0, w, h);
  speckle(ctx, w, h, piece.seed, 6);
  ctx.fillStyle = "rgb(36, 34, 32)";
  ctx.font = `500 ${3.3 * k}px ${family}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(piece.text, 3 * k, h / 2 + 0.2 * k);
  const mask = canvas2d(w, h);
  mask.fillStyle = "rgb(0,0,0)";
  mask.fillRect(0, 0, w, h);
  mask.fillStyle = "rgb(128,128,128)";
  mask.beginPath();
  const rand = rng(piece.seed + 0.5);
  const jag = () => (rand() - 0.5) * 0.5 * k;
  mask.moveTo(0.4 * k, 0.4 * k + jag());
  for (let x = 2 * k; x < w; x += 2 * k) mask.lineTo(x, 0.4 * k + jag());
  mask.lineTo(w - 0.4 * k, h - 0.4 * k);
  for (let x = w - 2 * k; x > 0; x -= 2 * k) mask.lineTo(x, h - 0.4 * k + jag());
  mask.closePath();
  mask.fill();
  return { color: ctx, mask };
}

function merge(built, piece) {
  const [w, h] = piece.px;
  const rgb = built.color.getImageData(0, 0, w, h).data;
  const m = built.mask.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = rgb[i];
    out[i + 1] = rgb[i + 1];
    out[i + 2] = rgb[i + 2];
    out[i + 3] = m[i];
  }
  return out;
}

export async function buildPiece(piece) {
  const family = await mono();
  if (piece.kind === "strip") return merge(buildStrip(piece, await Promise.all(piece.frames.map(loadImage))), piece);
  if (piece.kind === "negative") return merge(buildNegative(piece, await Promise.all(piece.frames.map(loadImage)), family), piece);
  if (piece.kind === "paper" && piece.frames) return merge(buildContact(piece, await Promise.all(piece.frames.map(loadImage)), family), piece);
  if (piece.kind === "paper") return merge(buildLabel(piece, family), piece);
  const img = await loadImage(piece.src);
  if (piece.kind === "mount") return merge(buildMount(piece, img, family), piece);
  return merge(buildMask(piece, img), piece);
}
