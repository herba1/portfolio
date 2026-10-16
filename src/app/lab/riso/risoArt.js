import { MARKS, TEX_H, TEX_W } from "./risoPosters";

const SERIF = "'Iowan Old Style', 'Times New Roman', Georgia, serif";

function fontStack(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export async function readyFonts() {
  const sans = fontStack("--font-sans", "ui-sans-serif, system-ui, sans-serif");
  const mono = fontStack("--font-mono", "ui-monospace, Menlo, monospace");
  try {
    await Promise.all([
      document.fonts.load(`600 200px ${sans}`),
      document.fonts.load(`500 40px ${sans}`),
      document.fonts.load(`500 40px ${mono}`),
      document.fonts.load(`italic 40px ${SERIF}`),
    ]);
  } catch {}
  return { sans, mono, serif: SERIF };
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

function surface(w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return { canvas, ctx };
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const PHOTO = { x: 96, y: 132, w: TEX_W - 192, h: 884 };

function photoTones(image, poster) {
  const { ctx } = surface(PHOTO.w, PHOTO.h);
  const iw = image.naturalWidth;
  const ih = image.naturalHeight;
  const scale = Math.max(PHOTO.w / iw, PHOTO.h / ih);
  const dw = iw * scale;
  const dh = ih * scale;
  const dx = (PHOTO.w - dw) / 2;
  const dy = (PHOTO.h - dh) * poster.focus;
  ctx.imageSmoothingQuality = "high";
  ctx.filter = "contrast(1.08)";
  ctx.drawImage(image, dx, dy, dw, dh);
  ctx.filter = "none";
  const data = ctx.getImageData(0, 0, PHOTO.w, PHOTO.h).data;
  const n = PHOTO.w * PHOTO.h;
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i += 1) {
    const r = data[i * 4] / 255;
    const g = data[i * 4 + 1] / 255;
    const b = data[i * 4 + 2] / 255;
    lum[i] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const blur = new Float32Array(n);
  const radius = 3;
  for (let y = 0; y < PHOTO.h; y += 1) {
    for (let x = 0; x < PHOTO.w; x += 1) {
      let sum = 0;
      let count = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const xx = Math.min(PHOTO.w - 1, Math.max(0, x + k));
        sum += lum[y * PHOTO.w + xx];
        count += 1;
      }
      blur[y * PHOTO.w + x] = sum / count;
    }
  }
  const sharp = new Float32Array(n);
  for (let y = 0; y < PHOTO.h; y += 1) {
    for (let x = 0; x < PHOTO.w; x += 1) {
      let sum = 0;
      let count = 0;
      for (let k = -radius; k <= radius; k += 1) {
        const yy = Math.min(PHOTO.h - 1, Math.max(0, y + k));
        sum += blur[yy * PHOTO.w + x];
        count += 1;
      }
      const i = y * PHOTO.w + x;
      sharp[i] = Math.min(1, Math.max(0, lum[i] + (lum[i] - sum / count) * 0.6));
    }
  }
  const [a0, b0, g0] = poster.curves[0];
  const [a1, b1, g1] = poster.curves[1];
  const light = new Uint8ClampedArray(n);
  const dark = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i += 1) {
    const d = 1 - sharp[i];
    const d0 = poster.lightFromHighlights ? sharp[i] : d;
    light[i] = Math.round(smooth(a0, b0, d0) * g0 * 255);
    dark[i] = Math.round(Math.pow(smooth(a1, b1, d), 1.1) * g1 * 255);
  }
  return { light, dark };
}

function track(ctx, size, em) {
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${(size * em).toFixed(2)}px`;
}

function drawMarks(ctx) {
  ctx.save();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2.5;
  for (const [x, y] of MARKS) {
    ctx.beginPath();
    ctx.arc(x, y, 13, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 26, y);
    ctx.lineTo(x + 26, y);
    ctx.moveTo(x, y - 26);
    ctx.lineTo(x, y + 26);
    ctx.stroke();
  }
  ctx.restore();
}

function fitSize(ctx, lines, family, maxW, start) {
  let size = start;
  for (let i = 0; i < 6; i += 1) {
    ctx.font = `600 ${size}px ${family}`;
    track(ctx, size, -0.045);
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (widest <= maxW) break;
    size = Math.floor(size * (maxW / widest));
  }
  return size;
}

function lightPlate(poster, fonts) {
  const { ctx } = surface(TEX_W, TEX_H);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  ctx.fillStyle = "#fff";
  drawMarks(ctx);

  const size = fitSize(ctx, poster.name, fonts.sans, TEX_W - 150, 236);
  ctx.font = `600 ${size}px ${fonts.sans}`;
  track(ctx, size, -0.045);
  ctx.textBaseline = "alphabetic";
  const base = PHOTO.y + PHOTO.h + Math.round(size * 0.74) + 4;
  ctx.fillText(poster.name[0], 82, base);
  ctx.fillText(poster.name[1], 82, base + Math.round(size * 0.84));

  ctx.fillRect(96, 1468, TEX_W - 192, 5);

  ctx.font = `italic 40px ${fonts.serif}`;
  track(ctx, 40, 0);
  const lead = `${poster.support[0]} `;
  ctx.fillText(lead, 96, 1622);
  const leadW = ctx.measureText(lead).width;
  ctx.font = `500 38px ${fonts.sans}`;
  track(ctx, 38, -0.012);
  ctx.fillText(poster.support[1], 96 + leadW + 4, 1622);

  ctx.font = `500 30px ${fonts.mono}`;
  track(ctx, 30, 0);
  ctx.textAlign = "right";
  ctx.fillText(poster.issue, TEX_W - 96, 1622);
  ctx.textAlign = "left";
  return ctx.getImageData(0, 0, TEX_W, TEX_H).data;
}

function darkPlate(poster, fonts) {
  const { ctx } = surface(TEX_W, TEX_H);
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, TEX_W, TEX_H);
  ctx.fillStyle = "#fff";
  drawMarks(ctx);

  ctx.font = `600 34px ${fonts.sans}`;
  track(ctx, 34, -0.012);
  ctx.fillText(poster.kicker, 96, 106);
  ctx.font = `500 30px ${fonts.mono}`;
  track(ctx, 30, 0);
  ctx.textAlign = "right";
  ctx.fillText(poster.rows[1][0], TEX_W - 96, 106);
  ctx.textAlign = "left";

  const cols = [96, 470, 838];
  poster.rows.forEach((row, i) => {
    ctx.font = i === 0 ? `600 36px ${fonts.sans}` : `500 32px ${fonts.mono}`;
    track(ctx, 36, i === 0 ? -0.014 : 0);
    ctx.fillText(row[0], cols[i], 1524);
    ctx.font = `450 28px ${fonts.sans}`;
    track(ctx, 28, -0.006);
    ctx.fillText(row[1], cols[i], 1564);
  });
  return ctx.getImageData(0, 0, TEX_W, TEX_H).data;
}

export async function buildPlates(poster, fonts) {
  const image = await loadImage(poster.src);
  const { light, dark } = photoTones(image, poster);
  const solid0 = lightPlate(poster, fonts);
  const solid1 = darkPlate(poster, fonts);
  const out = new Uint8Array(TEX_W * TEX_H * 4);
  for (let y = 0; y < PHOTO.h; y += 1) {
    const row = (PHOTO.y + y) * TEX_W + PHOTO.x;
    for (let x = 0; x < PHOTO.w; x += 1) {
      const o = (row + x) * 4;
      const i = y * PHOTO.w + x;
      out[o] = light[i];
      out[o + 1] = dark[i];
    }
  }
  for (let i = 0, n = TEX_W * TEX_H; i < n; i += 1) {
    out[i * 4 + 2] = solid0[i * 4];
    out[i * 4 + 3] = solid1[i * 4];
  }
  return out;
}
