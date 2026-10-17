import { WARP_LINES, WEFT_LINES } from "./loomLyrics";

export const ATLAS_W = 2048;
export const ROW_H = 80;

function familyOf(root, name, fallback) {
  const value = getComputedStyle(root).getPropertyValue(name).trim();
  return value || fallback;
}

export async function readyTapeFonts(root) {
  const mono = familyOf(root, "--font-mono", "ui-monospace, monospace");
  const serif = '"Iowan Old Style", "Times New Roman", Georgia, serif';
  const monoFont = `500 32px ${mono}`;
  const timeFont = `400 24px ${mono}`;
  const serifFont = `italic 400 36px ${serif}`;
  try {
    await Promise.all([document.fonts.load(monoFont), document.fonts.load(timeFont), document.fonts.load(serifFont)]);
  } catch {
    return { monoFont, timeFont, serifFont };
  }
  return { monoFont, timeFont, serifFont };
}

export function buildTapeAtlas(fonts, rows, cols) {
  const count = rows + cols;
  const canvas = document.createElement("canvas");
  canvas.width = ATLAS_W;
  canvas.height = count * ROW_H;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#fff";
  ctx.textBaseline = "alphabetic";
  const tiles = [];

  for (let r = 0; r < rows; r += 1) {
    const [line, time] = WEFT_LINES[r % WEFT_LINES.length];
    const y = r * ROW_H;
    ctx.font = fonts.monoFont;
    const lead = ctx.measureText("    ").width;
    const lineW = ctx.measureText(line).width;
    ctx.font = fonts.timeFont;
    const gap = ctx.measureText("   ").width;
    const timeW = ctx.measureText(time).width;
    const dot = ctx.measureText(" · ").width;
    const tile = Math.min(ATLAS_W - 2, Math.ceil(lead + lineW + gap * 2 + dot + timeW + lead * 0.5));
    ctx.font = fonts.monoFont;
    ctx.fillText(line, lead, y + ROW_H * 0.5 + 11);
    ctx.font = fonts.timeFont;
    ctx.fillText(" · ", lead + lineW + gap, y + ROW_H * 0.5 + 9);
    ctx.fillText(time, lead + lineW + gap + dot + gap * 0.4, y + ROW_H * 0.5 + 9);
    tiles.push(tile);
  }

  for (let c = 0; c < cols; c += 1) {
    const line = WARP_LINES[c % WARP_LINES.length];
    const y = (rows + c) * ROW_H;
    ctx.font = fonts.serifFont;
    const lead = ctx.measureText("     ").width;
    const lineW = ctx.measureText(line).width;
    const tile = Math.min(ATLAS_W - 2, Math.ceil(lead * 2 + lineW + ctx.measureText("  ·  ").width));
    ctx.fillText(line, lead, y + ROW_H * 0.5 + 11);
    ctx.fillText("·", lead + lineW + ctx.measureText("  ").width, y + ROW_H * 0.5 + 11);
    tiles.push(tile);
  }

  return { canvas, tiles, count };
}
