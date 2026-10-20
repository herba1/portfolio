export const SHEET_W = 1;
export const SHEET_H = 1.4;
export const PAPER = "#f7f3ea";
export const INK = "#1d2850";
export const TABLE = "#aaa49b";

const PX = 1400;
const TEX_W = Math.round(SHEET_W * PX);
const TEX_H = Math.round(SHEET_H * PX);

export const NOTE = {
  date: "Sunday, early",
  lines: [
    "Took the first train,",
    "you looked too peaceful",
    "to wake.",
    "",
    "Coffee's in the blue tin.",
    "The plant wants water",
    "(not much).",
    "",
    "Back Thursday.",
    "Miss you already.",
  ],
  sign: "M.",
};

export const OUTSIDE = "for when you wake up";

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

function handLine(ctx, text, x, y, size, family, rand) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((rand() - 0.5) * 0.012 - 0.004);
  ctx.font = `${size}px ${family}`;
  let at = 0;
  const words = text.split(" ");
  words.forEach((word, i) => {
    const lift = (rand() - 0.5) * size * 0.05;
    const alpha = 0.86 + rand() * 0.14;
    ctx.globalAlpha = alpha;
    ctx.fillText(word, at, lift);
    ctx.globalAlpha = alpha * 0.22;
    ctx.fillText(word, at + 0.8, lift + 0.6);
    at += ctx.measureText(word + (i < words.length - 1 ? " " : "")).width + size * (0.02 + rand() * 0.05);
  });
  ctx.restore();
  return at;
}

function heart(ctx, x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(-0.12);
  ctx.lineWidth = s * 0.075;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(0, s * 0.32);
  ctx.bezierCurveTo(-s * 0.08, s * 0.22, -s * 0.52, -s * 0.02, -s * 0.44, -s * 0.3);
  ctx.bezierCurveTo(-s * 0.36, -s * 0.56, -s * 0.06, -s * 0.5, 0.02, -s * 0.2);
  ctx.bezierCurveTo(0.1, -s * 0.52, s * 0.46, -s * 0.58, s * 0.46, -s * 0.24);
  ctx.bezierCurveTo(s * 0.46, s * 0.02, s * 0.1, s * 0.2, -s * 0.03, s * 0.36);
  ctx.stroke();
  ctx.restore();
}

export function drawFront(canvas, family) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, TEX_W, TEX_H);
  ctx.fillStyle = INK;
  ctx.textBaseline = "alphabetic";
  const rand = mulberry(2026);
  const size = 82;
  const lead = 120;
  ctx.textAlign = "left";
  ctx.font = `66px ${family}`;
  const dateW = ctx.measureText(NOTE.date).width;
  handLine(ctx, NOTE.date, TEX_W - 150 - dateW, 232, 66, family, rand);
  let y = 412;
  NOTE.lines.forEach((line, i) => {
    if (line) handLine(ctx, line, 150 + i * 3 + (rand() - 0.5) * 8, y, size, family, rand);
    y += line ? lead : lead * 0.62;
  });
  y += lead * 0.4;
  const w = handLine(ctx, NOTE.sign, 760, y, 92, family, rand);
  ctx.strokeStyle = INK;
  heart(ctx, 760 + w + 86, y - 36, 92);
  return canvas;
}

export function drawBack(canvas, family) {
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, TEX_W, TEX_H);
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.textBaseline = "alphabetic";
  const rand = mulberry(77);
  const size = 76;
  ctx.font = `${size}px ${family}`;
  const qw = TEX_W / 2;
  const qh = TEX_H / 2;
  const words = OUTSIDE.split(" ");
  const first = words.slice(0, 2).join(" ");
  const second = words.slice(2).join(" ");
  ctx.save();
  ctx.translate(qw / 2, qh / 2 - 20);
  ctx.rotate(-0.05);
  const w1 = ctx.measureText(first).width;
  const w2 = ctx.measureText(second).width;
  handLine(ctx, first, -w1 / 2 - 24, -20, size, family, rand);
  const end = handLine(ctx, second, -w2 / 2 + 18, 84, size, family, rand);
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.globalAlpha = 0.85;
  ctx.beginPath();
  const x0 = -w2 / 2 + 10;
  const x1 = -w2 / 2 + 18 + end + 6;
  ctx.moveTo(x0, 120);
  ctx.bezierCurveTo(x0 + (x1 - x0) * 0.3, 112, x0 + (x1 - x0) * 0.7, 128, x1, 114);
  ctx.stroke();
  ctx.restore();
  return canvas;
}

export function drawTable(canvas) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width;
  const h = canvas.height;
  const img = ctx.createImageData(w, h);
  const rand = mulberry(31);
  const base = [170, 164, 155];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const weave = (Math.sin(x * 1.9) * Math.sin(y * 1.9)) * 1.6;
      const n = (rand() - 0.5) * 7 + weave;
      const o = (y * w + x) * 4;
      img.data[o] = base[0] + n;
      img.data[o + 1] = base[1] + n;
      img.data[o + 2] = base[2] + n * 0.9;
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export function noiseData(size = 256) {
  const rand = mulberry(4142);
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < data.length; i += 1) data[i] = Math.floor(rand() * 256);
  return data;
}
