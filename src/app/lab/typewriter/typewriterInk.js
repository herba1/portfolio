import { INK_COL0, INK_COLS, LINE_UNITS, MARGIN_COLS, SHEET_LINES, TOP_LINES } from "./typewriterNotes";

export function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CLOG = { e: 0.9, a: 0.75, o: 0.45, g: 0.8, 8: 0.7, B: 0.55, R: 0.35, "@": 1, "&": 0.6, s: 0.3, d: 0.35, b: 0.4, p: 0.3, q: 0.35, 6: 0.45, 9: 0.45, m: 0.25 };

const wearCache = new Map();

export function wearOf(ch, left) {
  const key = `${ch}${left ? 1 : 0}`;
  const hit = wearCache.get(key);
  if (hit) return hit;
  const r = seeded(ch.charCodeAt(0) * 7919 + 131);
  const off = r() < 0.2 ? (r() - 0.5) * 0.14 : 0;
  const wear = {
    dx: (r() - 0.5) * 0.08,
    dy: (r() - 0.5) * 0.1 + off,
    rot: (r() - 0.5) * 0.045,
    density: (0.78 + r() * 0.22) * (left ? 1.08 : 0.9),
    tiltAngle: r() * Math.PI * 2,
    tilt: 0.18 + r() * 0.42,
    clog: CLOG[ch] ?? r() * 0.12,
  };
  wearCache.set(key, wear);
  return wear;
}

export function makeWeave(period, tint, alphaFloor) {
  const size = period * 16;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(size, size);
  const r = seeded(period * 977 + tint[0]);
  const TAU = Math.PI * 2;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const warp = 0.5 + 0.5 * Math.cos((TAU * (x + 0.5)) / period);
      const weft = 0.5 + 0.5 * Math.cos((TAU * (y + 0.5)) / period);
      const over = (Math.floor(x / period) + Math.floor(y / period)) % 2 === 0 ? warp : weft;
      const thread = Math.max(warp * 0.7, weft * 0.7, over);
      const blotch = 0.5 + 0.25 * Math.sin((TAU * x) / size + 1.3) * Math.sin((TAU * 2 * y) / size) + 0.25 * Math.sin((TAU * 3 * (x + y)) / size);
      const v = Math.min(1, alphaFloor + (1 - alphaFloor) * (0.55 * thread + 0.25 * r() + 0.2 * blotch));
      const i = (y * size + x) * 4;
      img.data[i] = tint[0];
      img.data[i + 1] = tint[1];
      img.data[i + 2] = tint[2];
      img.data[i + 3] = Math.round(v * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

export default class InkSheet {
  constructor(family) {
    this.family = family;
    this.res = 0;
    this.canvas = document.createElement("canvas");
    this.ctx = null;
    this.glyph = document.createElement("canvas");
    this.bite = document.createElement("canvas");
  }

  setResolution(res) {
    if (res === this.res) return false;
    this.res = res;
    this.canvas.width = Math.round(INK_COLS * res);
    this.canvas.height = Math.round(SHEET_LINES * LINE_UNITS * res);
    this.ctx = this.canvas.getContext("2d", { willReadFrequently: true });
    this.S = Math.ceil(res * 2.6);
    this.glyph.width = this.S;
    this.glyph.height = this.S;
    this.bite.width = this.S;
    this.bite.height = this.S;
    this.gctx = this.glyph.getContext("2d");
    this.bctx = this.bite.getContext("2d");
    const probe = 100;
    this.gctx.font = `500 ${probe}px ${this.family}`;
    const advance = this.gctx.measureText("M").width / probe || 0.6;
    this.fontPx = res / advance;
    this.font = `500 ${this.fontPx.toFixed(2)}px ${this.family}`;
    const period = Math.max(3, Math.round(res * 0.13));
    this.weave = this.gctx.createPattern(makeWeave(period, [255, 0, 0], 0.42), "repeat");
    this.clear();
    return true;
  }

  clear() {
    if (!this.ctx) return;
    this.ctx.globalCompositeOperation = "source-over";
    this.ctx.globalAlpha = 1;
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.fillStyle = "#000";
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
  }

  stamp(strike) {
    const { res, S, gctx, bctx, ctx } = this;
    const w = wearOf(strike.ch, strike.left);
    const r = seeded(strike.seed);
    const ox = S / 2;
    const oy = S * 0.62;

    gctx.setTransform(1, 0, 0, 1, 0, 0);
    gctx.globalCompositeOperation = "source-over";
    gctx.globalAlpha = 1;
    gctx.clearRect(0, 0, S, S);
    gctx.font = this.font;
    gctx.textAlign = "center";
    gctx.textBaseline = "alphabetic";
    gctx.fillStyle = "#f00";
    gctx.strokeStyle = "#f00";
    gctx.lineJoin = "round";
    gctx.fillText(strike.ch, ox, oy);
    gctx.lineWidth = this.fontPx * (0.02 + w.clog * 0.03) * (0.75 + strike.force * 0.3);
    gctx.strokeText(strike.ch, ox, oy);

    gctx.globalCompositeOperation = "destination-in";
    this.weave.setTransform(new DOMMatrix([1, 0, 0, 1, -strike.weave[0] * S, -strike.weave[1] * S]));
    gctx.fillStyle = this.weave;
    gctx.fillRect(0, 0, S, S);
    const ca = Math.cos(w.tiltAngle);
    const sa = Math.sin(w.tiltAngle);
    const cy = oy - this.fontPx * 0.32;
    const rr = this.fontPx * 0.46;
    const grad = gctx.createLinearGradient(ox - ca * rr, cy - sa * rr, ox + ca * rr, cy + sa * rr);
    grad.addColorStop(0, `rgba(255,0,0,${(1 - w.tilt).toFixed(3)})`);
    grad.addColorStop(0.45, `rgba(255,0,0,${(1 - w.tilt * 0.35).toFixed(3)})`);
    grad.addColorStop(1, "rgba(255,0,0,1)");
    gctx.fillStyle = grad;
    gctx.fillRect(0, 0, S, S);

    bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.clearRect(0, 0, S, S);
    bctx.font = this.font;
    bctx.textAlign = "center";
    bctx.textBaseline = "alphabetic";
    bctx.lineJoin = "round";
    bctx.shadowColor = "rgb(0,255,0)";
    bctx.shadowBlur = Math.max(1, res * 0.06);
    bctx.shadowOffsetX = S * 3;
    bctx.fillStyle = "#0f0";
    bctx.strokeStyle = "#0f0";
    bctx.lineWidth = this.fontPx * 0.05;
    bctx.fillText(strike.ch, ox - S * 3, oy);
    bctx.strokeText(strike.ch, ox - S * 3, oy);

    const X = (MARGIN_COLS + strike.col + 0.5 - INK_COL0 + w.dx + (r() - 0.5) * 0.035) * res;
    const Y = ((TOP_LINES + strike.line) * LINE_UNITS + w.dy + (r() - 0.5) * 0.03) * res;
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    ctx.translate(X, Y);
    ctx.rotate(w.rot + (r() - 0.5) * 0.01);
    ctx.globalAlpha = Math.min(1, Math.max(0.3, w.density * strike.force * strike.ribbon));
    ctx.drawImage(this.glyph, -ox, -oy);
    ctx.globalAlpha = Math.min(1, 0.42 * strike.force);
    ctx.drawImage(this.bite, -ox, -oy);
    ctx.restore();

    const half = S * 0.75;
    const x0 = Math.max(0, Math.floor(X - half));
    const y0 = Math.max(0, Math.floor(Y - half));
    const x1 = Math.min(this.canvas.width, Math.ceil(X + half));
    const y1 = Math.min(this.canvas.height, Math.ceil(Y + half));
    return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  }
}
