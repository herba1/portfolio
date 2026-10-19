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
  const random = mulberry(seed);

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
      const fade = 1 - smooth(0.97, 1.02, edge);
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
      const chroma = (Math.max(r, g, b) - Math.min(r, g, b)) / 255;
      const ink = Math.min(1, Math.max(0, (1 - lum) * 1.1 - 0.03, chroma * 0.72)) * fade;
      positions[index * 2] = x;
      positions[index * 2 + 1] = y;
      colors[index * 4] = r;
      colors[index * 4 + 1] = g;
      colors[index * 4 + 2] = b;
      colors[index * 4 + 3] = Math.round(ink * 255);
    }
  }

  return { grid, count, positions, colors };
}
