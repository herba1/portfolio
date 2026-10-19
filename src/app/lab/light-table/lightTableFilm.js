import { albumById } from "@/app/lab/_music/catalog";

export const TEXEL_MM = 13;
export const ATLAS_W = 4096;
export const ATLAS_H = 2048;
export const FRAME = 56;
export const PITCH = 62;
export const FILM_W = 62;
export const MASK = 66;

const KIND_CODE = { mask: 0, strip: 3 };

const cover = (id) => albumById(id).cover;

export const PIECES = [
  { key: "revolver", kind: "mask", seed: 0.21, at: [968, 860], src: cover("revolver") },
  {
    key: "roll",
    kind: "strip",
    seed: 0.31,
    at: [8, 8],
    frames: [cover("abbey-road"), cover("let-it-be"), cover("rubber-soul")],
  },
  { key: "help", kind: "mask", seed: 0.52, at: [2520, 8], src: cover("help") },
  { key: "pepper", kind: "mask", seed: 0.84, at: [8, 860], src: cover("sgt-pepper") },
];

for (const piece of PIECES) {
  const strip = piece.kind === "strip";
  piece.code = KIND_CODE[piece.kind];
  piece.w = strip ? piece.frames.length * PITCH + 4 : MASK;
  piece.h = strip ? FILM_W : MASK;
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
    box: [6, 4, 240, 180],
    pieces: {
      roll: [108, 44, -1.4],
      revolver: [198, 64, 3.2],
      help: [88, 134, -3],
      pepper: [172, 140, 2],
    },
  },
  {
    key: "tall",
    box: [6, 4, 176, 238],
    pieces: {
      roll: [44, 104, 90.6],
      help: [134, 46, -3],
      pepper: [138, 126, 2.4],
      revolver: [72, 200, -2.6],
    },
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

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
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

function blackPaper(ctx, w, h, seed) {
  const rand = rng(seed);
  ctx.fillStyle = "rgb(20, 20, 22)";
  ctx.fillRect(0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * 5;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(data, 0, 0);
}

function buildMask(piece, img) {
  const [w, h] = piece.px;
  const k = TEXEL_MM;
  const color = document.createElement("canvas");
  color.width = w;
  color.height = h;
  const ctx = color.getContext("2d", { willReadFrequently: true });
  const mask = document.createElement("canvas");
  mask.width = w;
  mask.height = h;
  const mctx = mask.getContext("2d");
  const win = FRAME * k;
  const wx = (w - win) / 2;
  const wy = (h - win) / 2;

  blackPaper(ctx, w, h, piece.seed);
  ctx.strokeStyle = "rgba(255,255,255,0.05)";
  ctx.lineWidth = 0.3 * k;
  roundRect(ctx, wx - 0.8 * k, wy - 0.8 * k, win + 1.6 * k, win + 1.6 * k, 0.8 * k);
  ctx.stroke();

  ctx.save();
  roundRect(ctx, wx, wy, win, win, 0.5 * k);
  ctx.clip();
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, wx, wy, win, win);
  ctx.restore();
  grade(ctx, Math.floor(wx), Math.floor(wy), Math.ceil(win), Math.ceil(win));

  mctx.fillStyle = "rgb(0,0,0)";
  mctx.fillRect(0, 0, w, h);
  mctx.fillStyle = "rgb(128,128,128)";
  roundRect(mctx, 0, 0, w, h, 1.6 * k);
  mctx.fill();
  mctx.fillStyle = "rgb(255,255,255)";
  roundRect(mctx, wx, wy, win, win, 0.5 * k);
  mctx.fill();
  return { color: ctx, mask: mctx };
}

function buildStrip(piece, images) {
  const [w, h] = piece.px;
  const k = TEXEL_MM;
  const color = document.createElement("canvas");
  color.width = w;
  color.height = h;
  const ctx = color.getContext("2d", { willReadFrequently: true });
  const mask = document.createElement("canvas");
  mask.width = w;
  mask.height = h;
  const mctx = mask.getContext("2d");

  ctx.fillStyle = "rgb(9, 8, 8)";
  ctx.fillRect(0, 0, w, h);
  const fy = ((FILM_W - FRAME) / 2) * k;
  ctx.imageSmoothingQuality = "high";
  images.forEach((img, i) => {
    const fx = (2 + 3 + i * PITCH) * k;
    ctx.save();
    roundRect(ctx, fx, fy, FRAME * k, FRAME * k, 0.4 * k);
    ctx.clip();
    ctx.drawImage(img, fx, fy, FRAME * k, FRAME * k);
    ctx.restore();
    grade(ctx, Math.floor(fx), Math.floor(fy), Math.ceil(FRAME * k), Math.ceil(FRAME * k));
  });

  mctx.fillStyle = "rgb(0,0,0)";
  mctx.fillRect(0, 0, w, h);
  mctx.fillStyle = "rgb(255,255,255)";
  roundRect(mctx, 0, 0, w, h, 0.5 * k);
  mctx.fill();
  return { color: ctx, mask: mctx };
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
  if (piece.kind === "strip") {
    const images = await Promise.all(piece.frames.map((src) => loadImage(src)));
    return merge(buildStrip(piece, images), piece);
  }
  const img = await loadImage(piece.src);
  return merge(buildMask(piece, img), piece);
}
