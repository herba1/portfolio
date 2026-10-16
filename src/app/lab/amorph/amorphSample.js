const TONE_BANDS = 18;

function hilbertIndex(side, x, y) {
  let index = 0;
  for (let span = side >> 1; span > 0; span >>= 1) {
    const right = (x & span) > 0 ? 1 : 0;
    const lower = (y & span) > 0 ? 1 : 0;
    index += span * span * ((3 * right) ^ lower);
    if (lower === 0) {
      if (right === 1) {
        x = span * 2 - 1 - x;
        y = span * 2 - 1 - y;
      }
      const swap = x;
      x = y;
      y = swap;
    }
  }
  return index;
}

function mulberry(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function smooth(edge0, edge1, value) {
  const t = Math.min(1, Math.max(0, (value - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`could not load ${src}`));
    image.src = src;
  });
}

export function samplePortrait(image, grid, seed) {
  const res = grid * 2;
  const canvas = document.createElement("canvas");
  canvas.width = res;
  canvas.height = res;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, res, res);
  const pixels = context.getImageData(0, 0, res, res).data;

  const count = grid * grid;
  const positions = new Float32Array(count * 2);
  const colors = new Uint8Array(count * 4);
  const inks = new Float32Array(count);
  const curve = new Float64Array(count);
  const random = mulberry(seed);
  let hilbertSide = 1;
  while (hilbertSide < grid) hilbertSide <<= 1;

  for (let gy = 0; gy < grid; gy += 1) {
    for (let gx = 0; gx < grid; gx += 1) {
      const index = gy * grid + gx;
      const u = (gx + 0.5 + (random() - 0.5) * 0.56) / grid;
      const v = (gy + 0.5 + (random() - 0.5) * 0.56) / grid;
      const px = Math.min(res - 1, Math.max(0, Math.floor(u * res)));
      const py = Math.min(res - 1, Math.max(0, Math.floor(v * res)));
      const offset = (py * res + px) * 4;
      const r = pixels[offset];
      const g = pixels[offset + 1];
      const b = pixels[offset + 2];
      const x = u * 2 - 1;
      const y = 1 - v * 2;
      const edge = Math.pow(Math.pow(Math.abs(x), 5) + Math.pow(Math.abs(y * 1.02), 5), 0.2);
      const fade = 1 - smooth(0.8, 1.0, edge);
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const ink = Math.min(1, Math.max(0, (1 - lum) * 1.1 - 0.03)) * fade;
      positions[index * 2] = x;
      positions[index * 2 + 1] = y;
      colors[index * 4] = r;
      colors[index * 4 + 1] = g;
      colors[index * 4 + 2] = b;
      colors[index * 4 + 3] = Math.round(ink * 255);
      inks[index] = ink + random() * 1e-4;
      curve[index] = hilbertIndex(hilbertSide, gx, gy);
    }
  }

  const byInk = new Int32Array(count);
  for (let index = 0; index < count; index += 1) byInk[index] = index;
  byInk.sort((a, b) => inks[a] - inks[b]);

  const order = new Int32Array(count);
  const band = Math.ceil(count / TONE_BANDS);
  for (let start = 0; start < count; start += band) {
    const slice = byInk.slice(start, Math.min(count, start + band));
    slice.sort((a, b) => curve[a] - curve[b]);
    order.set(slice, start);
  }
  const rank = new Int32Array(count);
  for (let position = 0; position < count; position += 1) rank[order[position]] = position;

  return { grid, count, positions, colors, order, rank };
}
