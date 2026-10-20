import { NG, SUB_X, SUB_Y } from "./bustShader";

export const GLYPHS = [" ", ".", "'", ",", ":", ";", "-", "_", "=", "+", "/", "\\", "|", "(", ")", "^", "~", "o", "*", "O", "8", "%", "#", "@"];
export const WEIGHTS = [330, 480, 720];

const GW = 48;
const GH = 96;
const PAD = 8;
export const TILE = { w: GW + PAD * 2, h: GH + PAD * 2, pad: PAD };

function monoStack() {
  const value = getComputedStyle(document.documentElement).getPropertyValue("--font-mono").trim();
  return value || "ui-monospace, Menlo, monospace";
}

export async function buildAtlas() {
  const mono = monoStack();
  try {
    await Promise.all(WEIGHTS.map((w) => document.fonts.load(`${w} 80px ${mono}`, GLYPHS.join(""))));
  } catch {}
  const canvas = document.createElement("canvas");
  canvas.width = TILE.w * NG;
  canvas.height = TILE.h * WEIGHTS.length;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fff";
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  WEIGHTS.forEach((weight, row) => {
    ctx.font = `${weight} 80px ${mono}`;
    const m = ctx.measureText("Hg");
    const asc = m.fontBoundingBoxAscent || 74;
    const desc = m.fontBoundingBoxDescent || 22;
    const baseline = PAD + (GH - (asc + desc)) / 2 + asc;
    GLYPHS.forEach((ch, i) => {
      if (ch === " ") return;
      ctx.fillText(ch, i * TILE.w + PAD + GW / 2, row * TILE.h + baseline);
    });
  });
  const data = ctx.getImageData(0, TILE.h, canvas.width, TILE.h).data;
  const raw = [];
  const means = [];
  const sx = GW / SUB_X;
  const sy = GH / SUB_Y;
  const sigma = 0.7;
  for (let g = 0; g < NG; g += 1) {
    const desc = [];
    for (let j = 0; j < SUB_Y; j += 1) {
      for (let i = 0; i < SUB_X; i += 1) {
        const cx = (i + 0.5) * sx;
        const cy = (j + 0.5) * sy;
        let acc = 0;
        let wsum = 0;
        for (let y = 0; y < GH; y += 2) {
          for (let x = 0; x < GW; x += 2) {
            const dx = (x + 1 - cx) / sx;
            const dy = (y + 1 - cy) / sy;
            const wgt = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
            const a = data[((y + PAD) * canvas.width + g * TILE.w + PAD + x) * 4 + 3] / 255;
            acc += a * wgt;
            wsum += wgt;
          }
        }
        desc.push(acc / wsum);
      }
    }
    raw.push(desc);
    means.push(desc.reduce((s, v) => s + v, 0) / desc.length);
  }
  const maxMean = Math.max(...means);
  const k = 0.86 / Math.max(maxMean, 1e-4);
  const glyph = new Float32Array(NG * SUB_X * SUB_Y);
  raw.forEach((desc, g) => desc.forEach((v, i) => (glyph[g * desc.length + i] = v * k)));
  const mean = new Float32Array(means.map((m) => m * k));
  return { canvas, glyph, mean };
}
