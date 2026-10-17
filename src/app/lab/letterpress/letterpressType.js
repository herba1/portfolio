export const SLOT = 256;
export const SLOT_COLS = 8;
export const SLOT_ROWS = 3;
export const SLOTS = SLOT_COLS * SLOT_ROWS;
export const INK_RES = 64;
export const MAX_CHARS = 14;
export const LINE_MAX_W = 2.62;
export const BODY_MAX = 0.78;
export const BODY_MIN = 0.3;

const SERIF = "'Iowan Old Style', 'Palatino Linotype', 'Book Antiqua', Palatino, 'Times New Roman', Georgia, serif";

function fontStack(name, fallback) {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

export async function readyFonts() {
  const sans = fontStack("--font-sans", "ui-sans-serif, system-ui, sans-serif");
  try {
    await Promise.all([document.fonts.load(`700 200px ${sans}`), document.fonts.load(`italic 430 200px ${SERIF}`)]);
  } catch {}
  return { sans, serif: SERIF };
}

export function faceFont(face, fonts, px) {
  return face === "italic" ? `italic 430 ${px}px ${fonts.serif}` : `700 ${px}px ${fonts.sans}`;
}

const EM = 0.9;

export function createMeasurer(fonts) {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 8;
  const ctx = canvas.getContext("2d");
  const cache = new Map();
  return function advance(ch, face) {
    const key = `${face}:${ch}`;
    if (cache.has(key)) return cache.get(key);
    ctx.font = faceFont(face, fonts, 100);
    const m = ctx.measureText(ch);
    const value = {
      advance: m.width / 100,
      left: (m.actualBoundingBoxLeft || 0) / 100,
      right: (m.actualBoundingBoxRight || m.width) / 100,
    };
    cache.set(key, value);
    return value;
  };
}

export function sortWidthEm(ch, face, advance) {
  if (ch === " ") return 0.3;
  const m = advance(ch, face);
  const shoulder = face === "italic" ? 0.05 : 0.035;
  const ink = Math.max(m.advance, m.right + m.left);
  return (Math.max(m.advance, ink * 0.96) + shoulder * 2) * EM;
}

export function layoutLine(chars, face, advance) {
  const ems = chars.map((ch) => sortWidthEm(ch, face, advance));
  const gap = 0.006;
  const totalEm = ems.reduce((a, b) => a + b, 0);
  const body = Math.max(BODY_MIN, Math.min(BODY_MAX, (LINE_MAX_W - gap * Math.max(0, chars.length - 1)) / Math.max(0.5, totalEm)));
  const widths = ems.map((e) => e * body);
  const total = widths.reduce((a, b) => a + b, 0) + gap * Math.max(0, chars.length - 1);
  const xs = [];
  let x = -total / 2;
  for (const w of widths) {
    xs.push(x + w / 2);
    x += w + gap;
  }
  return { body, widths, xs, total };
}

function boxBlur(src, dst, w, h, r, horizontal) {
  const norm = 1 / (2 * r + 1);
  if (horizontal) {
    for (let y = 0; y < h; y += 1) {
      const row = y * w;
      let acc = 0;
      for (let k = -r; k <= r; k += 1) acc += src[row + Math.min(w - 1, Math.max(0, k))];
      for (let x = 0; x < w; x += 1) {
        dst[row + x] = acc * norm;
        const add = Math.min(w - 1, x + r + 1);
        const sub = Math.max(0, x - r);
        acc += src[row + add] - src[row + sub];
      }
    }
  } else {
    for (let x = 0; x < w; x += 1) {
      let acc = 0;
      for (let k = -r; k <= r; k += 1) acc += src[Math.min(h - 1, Math.max(0, k)) * w + x];
      for (let y = 0; y < h; y += 1) {
        dst[y * w + x] = acc * norm;
        const add = Math.min(h - 1, y + r + 1);
        const sub = Math.max(0, y - r);
        acc += src[add * w + x] - src[sub * w + x];
      }
    }
  }
}

function blurred(mask, w, h, r) {
  const a = new Float32Array(mask);
  const b = new Float32Array(mask.length);
  for (let i = 0; i < 3; i += 1) {
    boxBlur(a, b, w, h, r, true);
    boxBlur(b, a, w, h, r, false);
  }
  return a;
}

export function createGlyphPainter(fonts) {
  const canvas = document.createElement("canvas");
  canvas.width = SLOT;
  canvas.height = SLOT;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  return function paint(ch, face, widthEm) {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, SLOT, SLOT);
    const mask = new Float32Array(SLOT * SLOT);
    if (ch !== " ") {
      const px = SLOT * EM;
      ctx.font = faceFont(face, fonts, px);
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
      const probe = ctx.measureText("Hg");
      const asc = probe.fontBoundingBoxAscent || px * 0.92;
      const desc = probe.fontBoundingBoxDescent || px * 0.24;
      const m = ctx.measureText(ch);
      const glyphW = Math.max(m.width, (m.actualBoundingBoxRight || m.width) + (m.actualBoundingBoxLeft || 0));
      const blockPx = widthEm * SLOT;
      const sx = SLOT / blockPx;
      const left = (blockPx - glyphW) / 2 + (m.actualBoundingBoxLeft || 0);
      const baseline = (SLOT - (asc + desc)) / 2 + asc;
      ctx.setTransform(sx, 0, 0, 1, 0, 0);
      ctx.fillStyle = "#fff";
      ctx.fillText(ch, left, baseline);
      const data = ctx.getImageData(0, 0, SLOT, SLOT).data;
      for (let i = 0; i < mask.length; i += 1) mask[i] = data[i * 4 + 3] / 255;
    }
    const soft = blurred(mask, SLOT, SLOT, 2);
    const wide = blurred(mask, SLOT, SLOT, 7);
    const low = new Float32Array(INK_RES * INK_RES);
    const step = SLOT / INK_RES;
    for (let y = 0; y < INK_RES; y += 1) {
      for (let x = 0; x < INK_RES; x += 1) {
        let acc = 0;
        for (let j = 0; j < step; j += 1) {
          const row = (y * step + j) * SLOT + x * step;
          for (let i = 0; i < step; i += 1) acc += mask[row + i];
        }
        low[y * INK_RES + x] = acc / (step * step);
      }
    }
    return { mask, soft, wide, low };
  };
}

export function writeSlot(atlas, slot, glyph) {
  const ox = (slot % SLOT_COLS) * SLOT;
  const oy = Math.floor(slot / SLOT_COLS) * SLOT;
  const stride = SLOT_COLS * SLOT;
  for (let y = 0; y < SLOT; y += 1) {
    for (let x = 0; x < SLOT; x += 1) {
      const i = y * SLOT + x;
      const o = ((oy + y) * stride + ox + x) * 4;
      atlas[o] = Math.round(glyph.mask[i] * 255);
      atlas[o + 1] = Math.round(Math.min(1, glyph.soft[i]) * 255);
      atlas[o + 2] = Math.round(Math.min(1, glyph.wide[i]) * 255);
      atlas[o + 3] = 255;
    }
  }
}

export function slotRect(slot) {
  return [(slot % SLOT_COLS) / SLOT_COLS, Math.floor(slot / SLOT_COLS) / SLOT_ROWS, 1 / SLOT_COLS, 1 / SLOT_ROWS];
}
