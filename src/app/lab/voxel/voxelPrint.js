export const COLS = 44;
export const ROWS = 55;
export const CELL = 0.1;
export const PRINT_W = COLS * CELL;
export const PRINT_H = ROWS * CELL;
export const BORDER = 0.3;

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleCells(img) {
  const mid = document.createElement("canvas");
  mid.width = COLS * 4;
  mid.height = ROWS * 4;
  const m = mid.getContext("2d", { willReadFrequently: true });
  m.imageSmoothingQuality = "high";
  m.drawImage(img, 0, 0, mid.width, mid.height);
  const data = m.getImageData(0, 0, mid.width, mid.height).data;
  const lum = new Float32Array(COLS * ROWS);
  const tint = new Float32Array(COLS * ROWS * 3);
  const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  for (let j = 0; j < ROWS; j += 1) {
    for (let i = 0; i < COLS; i += 1) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let y = 0; y < 4; y += 1) {
        for (let x = 0; x < 4; x += 1) {
          const k = ((j * 4 + y) * mid.width + i * 4 + x) * 4;
          r += toLinear(data[k] / 255);
          g += toLinear(data[k + 1] / 255);
          b += toLinear(data[k + 2] / 255);
        }
      }
      const n = j * COLS + i;
      tint[n * 3] = r / 16;
      tint[n * 3 + 1] = g / 16;
      tint[n * 3 + 2] = b / 16;
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lum[n] = Math.pow(Math.max(0, l / 16), 1 / 2.2);
    }
  }
  return { lum, tint };
}

export function paperCanvas(img) {
  const ppu = 200;
  const w = Math.round((PRINT_W + BORDER * 2) * ppu);
  const h = Math.round((PRINT_H + BORDER * 2) * ppu);
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = "#f3f0e9";
  g.fillRect(0, 0, w, h);
  const x0 = BORDER * ppu;
  const y0 = BORDER * ppu;
  const iw = PRINT_W * ppu;
  const ih = PRINT_H * ppu;
  g.save();
  g.filter = "grayscale(1) contrast(0.9)";
  g.globalAlpha = 0.16;
  g.drawImage(img, x0, y0, iw, ih);
  g.restore();
  g.fillStyle = "rgba(60, 52, 44, 0.05)";
  g.fillRect(x0, y0, iw, ih);
  g.strokeStyle = "rgba(60, 52, 44, 0.09)";
  g.lineWidth = 1;
  g.beginPath();
  for (let i = 0; i <= COLS; i += 1) {
    const x = Math.round(x0 + i * CELL * ppu) + 0.5;
    g.moveTo(x, y0);
    g.lineTo(x, y0 + ih);
  }
  for (let j = 0; j <= ROWS; j += 1) {
    const y = Math.round(y0 + j * CELL * ppu) + 0.5;
    g.moveTo(x0, y);
    g.lineTo(x0 + iw, y);
  }
  g.stroke();
  const rand = rng(9);
  const grain = g.getImageData(0, 0, w, h);
  const d = grain.data;
  for (let k = 0; k < d.length; k += 4) {
    const n = (rand() - 0.5) * 7;
    d[k] += n;
    d[k + 1] += n;
    d[k + 2] += n;
  }
  g.putImageData(grain, 0, 0);
  return c;
}

export function floorCanvas(size) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const g = c.getContext("2d");
  const img = g.createImageData(size, size);
  const rand = rng(31);
  const d = img.data;
  for (let k = 0; k < d.length; k += 4) {
    const n = 242 + (rand() - 0.5) * 18;
    d[k] = n;
    d[k + 1] = n;
    d[k + 2] = n;
    d[k + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}
