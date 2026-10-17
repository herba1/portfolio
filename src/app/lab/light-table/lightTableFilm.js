export const TEXEL_MM = 13;
export const ATLAS_W = 4096;
export const ATLAS_H = 2048;
export const PITCH = 38;
export const FRAME_W = 36;
export const FRAME_H = 24;
export const FILM_W = 35;
export const MOUNT = 50;

const KIND_CODE = { slideLand: 0, slidePort: 1, neg: 2, chrome: 3 };

const stripLength = (n) => n * PITCH + 2;

export const PIECES = [
  {
    key: "negA",
    kind: "neg",
    seed: 0.31,
    first: 11,
    stock: "HB 400-5",
    at: [8, 8],
    frames: [
      { src: "/scorch/reading.webp" },
      { src: "/scorch/meadow.webp", crop: [0.02, 0.06, 0.88, 0.587] },
      { src: "/scorch/wires.webp", crop: [0, 0.18, 1, 0.63] },
      { src: "/monovolt/cosmos-midnight.webp" },
    ],
  },
  {
    key: "negB",
    kind: "neg",
    seed: 0.67,
    first: 23,
    stock: "HB 400-5",
    at: [2052, 8],
    frames: [
      { src: "/monovolt/abt1.webp", turn: true },
      { src: "/scorch/clock.webp", crop: [0, 0.14, 1, 0.63] },
      { src: "/monovolt/abt7.webp", turn: true },
      { src: "/scorch/beams.webp", crop: [0, 0.14, 1, 0.667] },
    ],
  },
  {
    key: "chrome",
    kind: "chrome",
    seed: 0.13,
    first: 7,
    stock: "HB 100 E",
    at: [8, 479],
    frames: [
      { src: "/monovolt/abt10.webp", turn: true },
      { src: "/monovolt/abt6.webp", turn: true },
      { src: "/monovolt/lp-giobbi.webp" },
    ],
  },
  {
    key: "louis",
    kind: "slideLand",
    seed: 0.52,
    at: [1558, 479],
    src: "/monovolt/louis-the-child.webp",
    mount: "card",
    paper: [233, 229, 219],
    ink: [34, 46, 112],
    top: "louis · press",
    bottom: "06 · 23",
    dot: true,
  },
  {
    key: "crowd",
    kind: "slideLand",
    seed: 0.84,
    at: [2224, 479],
    src: "/monovolt/abt5.webp",
    crop: [0, 0.22, 1, 0.533],
    mount: "plastic",
    paper: [168, 170, 168],
    ink: [24, 24, 26],
    top: "back room",
    bottom: "no. 14",
  },
  {
    key: "tunnel",
    kind: "slidePort",
    seed: 0.21,
    at: [2890, 479],
    src: "/scorch/valley.webp",
    crop: [0.05, 0.04, 0.55, 0.86],
    mount: "card",
    paper: [229, 222, 204],
    ink: [28, 28, 32],
    top: "alps",
    bottom: "dup",
  },
  {
    key: "visitor",
    kind: "slidePort",
    seed: 0.93,
    at: [8, 1145],
    src: "/scorch/visitor.webp",
    crop: [0.12, 0, 0.76, 1],
    mount: "card",
    paper: [236, 233, 226],
    ink: [36, 52, 128],
    top: "visitor",
    bottom: "sandwich?",
    dot: true,
  },
];

for (const piece of PIECES) {
  const strip = piece.kind === "neg" || piece.kind === "chrome";
  piece.code = KIND_CODE[piece.kind];
  piece.w = strip ? stripLength(piece.frames.length) : MOUNT;
  piece.h = strip ? FILM_W : MOUNT;
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
    w: 320,
    h: 200,
    loupe: [96, 40],
    pieces: {
      negA: [116, 40, -1.6],
      negB: [214, 170, 1.8],
      chrome: [276, 98, 87],
      louis: [48, 128, -7],
      crowd: [190, 104, 4],
      tunnel: [114, 127, -6],
      visitor: [119, 123, 2.5],
    },
  },
  {
    key: "square",
    w: 244,
    h: 232,
    loupe: [78, 36],
    pieces: {
      negA: [98, 36, -1.6],
      negB: [116, 202, 1.6],
      chrome: [214, 116, 88],
      louis: [42, 104, -7],
      crowd: [152, 96, 4],
      tunnel: [95, 145, -6],
      visitor: [100, 141, 2.5],
    },
  },
  {
    key: "tall",
    w: 180,
    h: 296,
    loupe: [70, 34],
    pieces: {
      negA: [90, 34, -1.6],
      negB: [90, 262, 1.6],
      chrome: [146, 168, 86],
      louis: [38, 94, -7],
      crowd: [128, 90, 5],
      tunnel: [63, 167, -6],
      visitor: [68, 163, 2.5],
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

function drawCover(ctx, img, crop, x, y, w, h, turn) {
  const [cx, cy, cw, ch] = crop || [0, 0, 1, 1];
  const iw = img.naturalWidth * cw;
  const ih = img.naturalHeight * ch;
  const ox = img.naturalWidth * cx;
  const oy = img.naturalHeight * cy;
  const tw = turn ? h : w;
  const th = turn ? w : h;
  const scale = Math.max(tw / iw, th / ih);
  const sw = tw / scale;
  const sh = th / scale;
  const sx = ox + (iw - sw) / 2;
  const sy = oy + (ih - sh) / 2;
  ctx.save();
  ctx.translate(x + w / 2, y + h / 2);
  if (turn) ctx.rotate(-Math.PI / 2);
  ctx.drawImage(img, sx, sy, sw, sh, -tw / 2, -th / 2, tw, th);
  ctx.restore();
}

function grade(ctx, x, y, w, h, kind) {
  const data = ctx.getImageData(x, y, w, h);
  const d = data.data;
  const chrome = kind !== "neg";
  for (let i = 0; i < d.length; i += 4) {
    let r = d[i] / 255;
    let g = d[i + 1] / 255;
    let b = d[i + 2] / 255;
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const sat = chrome ? 1.18 : 1.06;
    r = l + (r - l) * sat;
    g = l + (g - l) * sat;
    b = l + (b - l) * sat;
    const curve = (v) => {
      const c = Math.min(1, Math.max(0, v));
      const s = c * c * (3 - 2 * c);
      return chrome ? c + (s - c) * 0.42 : c + (s - c) * 0.18;
    };
    d[i] = curve(r) * 255;
    d[i + 1] = curve(g) * 255;
    d[i + 2] = curve(b) * 255;
  }
  ctx.putImageData(data, x, y);
}

function handFamily(sans) {
  return `"Noteworthy", "Bradley Hand", "Segoe Print", "Ink Free", ${sans}`;
}

function drawHand(ctx, text, x, y, size, color, seed, family, align = "center") {
  const rand = rng(seed);
  ctx.save();
  ctx.font = `360 ${size}px ${family}`;
  ctx.textBaseline = "alphabetic";
  const chars = [...text];
  const widths = chars.map((c) => ctx.measureText(c).width * 0.94);
  const total = widths.reduce((a, b) => a + b, 0);
  let cursor = align === "center" ? x - total / 2 : x;
  const drift = (rand() - 0.5) * 0.05;
  chars.forEach((c, i) => {
    const jitterY = (rand() - 0.5) * size * 0.08 + i * drift * size * 0.2;
    const rot = (rand() - 0.5) * 0.16;
    const scale = 1 + (rand() - 0.5) * 0.1;
    ctx.save();
    ctx.translate(cursor + widths[i] / 2, y + jitterY);
    ctx.rotate(rot);
    ctx.transform(1, 0, -0.24, 1, 0, 0);
    ctx.scale(scale, scale);
    ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.9)`;
    ctx.fillText(c, -widths[i] / 2, 0);
    ctx.fillStyle = `rgba(${color[0]}, ${color[1]}, ${color[2]}, 0.35)`;
    ctx.fillText(c, -widths[i] / 2 + size * 0.025, size * 0.02);
    ctx.restore();
    cursor += widths[i] + (rand() - 0.5) * size * 0.05;
  });
  ctx.restore();
}

function paperTexture(ctx, w, h, base, seed, fibre) {
  const rand = rng(seed);
  ctx.fillStyle = `rgb(${base[0]}, ${base[1]}, ${base[2]})`;
  ctx.fillRect(0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (rand() - 0.5) * 9;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(data, 0, 0);
  if (!fibre) return;
  ctx.lineCap = "round";
  for (let i = 0; i < 700; i += 1) {
    const x = rand() * w;
    const y = rand() * h;
    const len = (0.4 + rand() * 1.6) * TEXEL_MM;
    const a = rand() * Math.PI;
    const dark = rand() < 0.5;
    ctx.strokeStyle = dark ? "rgba(90, 80, 60, 0.07)" : "rgba(255, 255, 250, 0.1)";
    ctx.lineWidth = 0.6 + rand() * 0.8;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a + 0.6) * len * 0.5, y + Math.sin(a + 0.6) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
}

function buildSlide(piece, img, fonts) {
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
  const portrait = piece.kind === "slidePort";
  const winW = (portrait ? 23 : 34.2) * k;
  const winH = (portrait ? 34.2 : 23) * k;
  const filmW = (portrait ? FRAME_H : FRAME_W) * k;
  const filmH = (portrait ? FRAME_W : FRAME_H) * k;
  const wx = (w - winW) / 2;
  const wy = (h - winH) / 2;

  paperTexture(ctx, w, h, piece.paper, piece.seed, piece.mount === "card");

  if (piece.mount === "plastic") {
    const g = ctx.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, "rgba(255,255,255,0.08)");
    g.addColorStop(0.5, "rgba(255,255,255,0)");
    g.addColorStop(1, "rgba(0,0,0,0.08)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "rgba(0,0,0,0.22)";
    ctx.lineWidth = 0.18 * k;
    roundRect(ctx, 1.1 * k, 1.1 * k, w - 2.2 * k, h - 2.2 * k, 1.2 * k);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.28)";
    ctx.lineWidth = 0.12 * k;
    roundRect(ctx, 1.35 * k, 1.35 * k, w - 2.7 * k, h - 2.7 * k, 1.1 * k);
    ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.18)";
    ctx.lineWidth = 0.6 * k;
    roundRect(ctx, wx - 0.9 * k, wy - 0.9 * k, winW + 1.8 * k, winH + 1.8 * k, 1.2 * k);
    ctx.stroke();
  } else {
    ctx.strokeStyle = "rgba(60,50,30,0.16)";
    ctx.lineWidth = 0.5 * k;
    roundRect(ctx, wx - 0.5 * k, wy - 0.5 * k, winW + k, winH + k, 1 * k);
    ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.lineWidth = 0.25 * k;
    roundRect(ctx, wx - 1.05 * k, wy - 1.05 * k, winW + 2.1 * k, winH + 2.1 * k, 1.3 * k);
    ctx.stroke();
  }

  const marginTop = wy;
  const labelSize = Math.min(marginTop * 0.5, 4.2 * k);
  const labelInk = piece.ink;
  if (piece.mount === "plastic") {
    const lw = 26 * k;
    const lh = Math.min(marginTop * 0.62, 8 * k);
    const ly = (marginTop - lh) / 2 + 0.3 * k;
    ctx.save();
    ctx.translate(w / 2, ly + lh / 2);
    ctx.rotate(-0.025);
    ctx.fillStyle = "rgb(240, 236, 226)";
    roundRect(ctx, -lw / 2, -lh / 2, lw, lh, 0.6 * k);
    ctx.fill();
    ctx.restore();
  }
  drawHand(ctx, piece.top, w / 2, marginTop * 0.5 + labelSize * 0.36, labelSize, labelInk, piece.seed + 0.11, handFamily(fonts.sans));
  drawHand(
    ctx,
    piece.bottom,
    w / 2 + (piece.dot ? -3 * k : 0),
    h - marginTop * 0.5 + labelSize * 0.36,
    labelSize * 0.9,
    piece.mount === "plastic" ? [238, 236, 230] : labelInk,
    piece.seed + 0.37,
    handFamily(fonts.sans),
  );
  if (piece.dot) {
    const r = 2.1 * k;
    const cx = w - 6.4 * k;
    const cy = h - 6.4 * k;
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
    g.addColorStop(0, "rgb(234, 82, 58)");
    g.addColorStop(1, "rgb(206, 52, 38)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  const fx = (w - filmW) / 2;
  const fy = (h - filmH) / 2;
  ctx.save();
  roundRect(ctx, wx, wy, winW, winH, 0.6 * k);
  ctx.clip();
  ctx.fillStyle = "rgb(8, 7, 6)";
  ctx.fillRect(wx, wy, winW, winH);
  drawCover(ctx, img, piece.crop, fx, fy, filmW, filmH, false);
  ctx.restore();
  grade(ctx, Math.floor(wx), Math.floor(wy), Math.ceil(winW), Math.ceil(winH), piece.kind);

  mctx.fillStyle = "rgb(0,0,0)";
  mctx.fillRect(0, 0, w, h);
  mctx.fillStyle = "rgb(128,128,128)";
  roundRect(mctx, 0, 0, w, h, 1.6 * k);
  mctx.fill();
  mctx.fillStyle = "rgb(255,255,255)";
  roundRect(mctx, wx, wy, winW, winH, 0.6 * k);
  mctx.fill();
  return { color: ctx, mask: mctx };
}

function buildStrip(piece, images, fonts) {
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
  const neg = piece.kind === "neg";
  const rand = rng(piece.seed + 0.5);

  ctx.fillStyle = neg ? "rgb(0,0,0)" : "rgb(10, 9, 8)";
  ctx.fillRect(0, 0, w, h);
  const fy = ((FILM_W - FRAME_H) / 2) * k;
  piece.frames.forEach((frame, i) => {
    const fx = (2 + i * PITCH) * k;
    ctx.save();
    roundRect(ctx, fx, fy, FRAME_W * k, FRAME_H * k, 0.5 * k);
    ctx.clip();
    drawCover(ctx, images[i], frame.crop, fx, fy, FRAME_W * k, FRAME_H * k, frame.turn);
    ctx.restore();
    grade(ctx, Math.floor(fx), Math.floor(fy), Math.ceil(FRAME_W * k), Math.ceil(FRAME_H * k), piece.kind);
  });

  const printInk = neg ? "rgba(235, 235, 235, 0.92)" : "rgba(214, 200, 150, 0.9)";
  ctx.fillStyle = printInk;
  ctx.font = `600 ${1.5 * k}px ${fonts.mono}`;
  ctx.textBaseline = "middle";
  const edgeY = (FILM_W - 1.05) * k;
  piece.frames.forEach((_, i) => {
    const fx = (2 + i * PITCH) * k;
    const n = piece.first + i;
    ctx.textAlign = "left";
    ctx.fillText(`${n}`, fx + 4 * k, edgeY);
    ctx.fillText(`▸${n}A`, fx + 22 * k, edgeY);
  });
  ctx.textAlign = "left";
  ctx.font = `600 ${1.35 * k}px ${fonts.mono}`;
  for (let i = 0; i < piece.frames.length; i += 2) {
    const fx = (2 + i * PITCH + 11 + rand() * 6) * k;
    ctx.fillText(piece.stock, fx, 1.05 * k);
  }

  mctx.fillStyle = "rgb(0,0,0)";
  mctx.fillRect(0, 0, w, h);
  mctx.fillStyle = "rgb(255,255,255)";
  roundRect(mctx, 0, 0, w, h, 0.5 * k);
  mctx.fill();
  mctx.fillStyle = "rgb(0,0,0)";
  const perfW = 2.8 * k;
  const perfH = 1.98 * k;
  const perfPitch = PITCH / 8;
  const count = Math.floor((piece.w - 1) / perfPitch);
  for (let i = 0; i < count; i += 1) {
    const px = (1.2 + i * perfPitch) * k;
    if (px + perfW > w - 0.5 * k) break;
    for (const py of [2.0 * k, h - 2.0 * k - perfH]) {
      roundRect(mctx, px, py, perfW, perfH, 0.5 * k);
      mctx.fill();
    }
  }
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

export async function readFonts(box) {
  const style = getComputedStyle(box);
  const sans = style.getPropertyValue("--font-sans").trim() || "sans-serif";
  const mono = style.getPropertyValue("--font-mono").trim() || "monospace";
  try {
    await document.fonts.ready;
  } catch {}
  return { sans, mono };
}

export async function buildPiece(piece, fonts) {
  if (piece.kind === "neg" || piece.kind === "chrome") {
    const images = await Promise.all(piece.frames.map((f) => loadImage(f.src)));
    return merge(buildStrip(piece, images, fonts), piece);
  }
  const img = await loadImage(piece.src);
  return merge(buildSlide(piece, img, fonts), piece);
}
