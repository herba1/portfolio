export const CELLS_X = 8;
export const CELLS_Y = 3;
const CELLS = CELLS_X * CELLS_Y;
const SCALE = 5;
const TILT = 0.42;
const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const AMBIENT = [0.0016, 0.0015, 0.0014];

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);
const luminance = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export function createScreenLight({ canvas, onGlow }) {
  const ctx = canvas.getContext("2d");
  const small = Object.assign(document.createElement("canvas"), { width: 64, height: 27 });
  const cells = Object.assign(document.createElement("canvas"), { width: CELLS_X, height: CELLS_Y });
  const smallCtx = small.getContext("2d", { willReadFrequently: true });
  const cellsCtx = cells.getContext("2d", { willReadFrequently: true });
  const target = new Float32Array(CELLS * 3);
  const color = new Float32Array(CELLS * 3);
  let weights = new Float32Array(0);
  let width = 0;
  let height = 0;
  let image = null;
  let gain = 1;
  let primed = false;

  const sample = (source, instant = false) => {
    try {
      smallCtx.drawImage(source, 0, 0, small.width, small.height);
      cellsCtx.drawImage(small, 0, 0, CELLS_X, CELLS_Y);
      const data = cellsCtx.getImageData(0, 0, CELLS_X, CELLS_Y).data;
      for (let i = 0; i < CELLS; i += 1) {
        target[i * 3] = toLinear(data[i * 4] / 255);
        target[i * 3 + 1] = toLinear(data[i * 4 + 1] / 255);
        target[i * 3 + 2] = toLinear(data[i * 4 + 2] / 255);
      }
      if (instant || !primed) {
        color.set(target);
        primed = true;
      }
      return true;
    } catch {
      return false;
    }
  };

  const layout = ({ roomWidth, roomHeight, screen }) => {
    width = Math.max(2, Math.ceil(roomWidth / SCALE));
    height = Math.max(2, Math.ceil(roomHeight / SCALE));
    canvas.width = width;
    canvas.height = height;
    image = ctx.createImageData(width, height);
    weights = new Float32Array(width * height * CELLS);
    const cellW = screen.width / CELLS_X;
    const cellH = screen.height / CELLS_Y;
    const area = cellW * cellH;
    const lift = screen.height * 0.55;
    const tiltY = Math.cos(TILT);
    const tiltZ = Math.sin(TILT);
    let peak = 0;
    for (let py = 0; py < height; py += 1) {
      const raw = (py + 0.5) * SCALE - screen.bottom;
      const fade = smooth(-40, 56, raw);
      const y = Math.max(raw, 0) + 10;
      for (let px = 0; px < width; px += 1) {
        const x = (px + 0.5) * SCALE;
        const o = (py * width + px) * CELLS;
        for (let j = 0; j < CELLS_Y; j += 1) {
          const h = lift + (CELLS_Y - j - 0.5) * cellH;
          for (let i = 0; i < CELLS_X; i += 1) {
            const cx = screen.left + (i + 0.5) * cellW;
            const dx = cx - x;
            const d2 = dx * dx + y * y + h * h;
            const d = Math.sqrt(d2);
            const receive = h / d;
            const emit = Math.max(0, (y * tiltY + h * tiltZ) / d);
            const w = (fade * receive * emit * area) / (d2 * Math.PI + area);
            weights[o + j * CELLS_X + i] = w;
          }
        }
        let total = 0;
        for (let k = 0; k < CELLS; k += 1) total += weights[o + k];
        if (total > peak) peak = total;
      }
    }
    gain = peak > 0 ? 7.5 / peak : 1;
  };

  const update = (dt) => {
    let changed = false;
    for (let i = 0; i < CELLS; i += 1) {
      const r = i * 3;
      const lt = luminance(target[r], target[r + 1], target[r + 2]);
      const lc = luminance(color[r], color[r + 1], color[r + 2]);
      const k = 1 - Math.exp(-dt * (lt > lc ? 40 : 14));
      for (let c = 0; c < 3; c += 1) {
        const delta = target[r + c] - color[r + c];
        if (Math.abs(delta) > 0.0004) changed = true;
        color[r + c] += delta * k;
      }
    }
    return changed;
  };

  const paint = () => {
    if (!image) return;
    const data = image.data;
    const n = width * height;
    for (let p = 0; p < n; p += 1) {
      const o = p * CELLS;
      let r = AMBIENT[0];
      let g = AMBIENT[1];
      let b = AMBIENT[2];
      for (let k = 0; k < CELLS; k += 1) {
        const w = weights[o + k] * gain;
        r += color[k * 3] * w;
        g += color[k * 3 + 1] * w;
        b += color[k * 3 + 2] * w;
      }
      const q = p * 4;
      data[q] = toSrgb(1 - Math.exp(-r * 2.2)) * 255;
      data[q + 1] = toSrgb(1 - Math.exp(-g * 2.2)) * 255;
      data[q + 2] = toSrgb(1 - Math.exp(-b * 2.2)) * 255;
      data[q + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    if (onGlow) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let k = 0; k < CELLS; k += 1) {
        r += color[k * 3];
        g += color[k * 3 + 1];
        b += color[k * 3 + 2];
      }
      onGlow(toSrgb(Math.min(1, (r / CELLS) * 1.6)), toSrgb(Math.min(1, (g / CELLS) * 1.6)), toSrgb(Math.min(1, (b / CELLS) * 1.6)));
    }
  };

  return { sample, layout, update, paint };
}
