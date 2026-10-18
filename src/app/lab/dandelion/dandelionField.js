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

export function buildLattice(cols) {
  const sp = 2 / cols;
  const rowStep = (sp * Math.sqrt(3)) / 2;
  const random = mulberry(90210 + cols);
  const home = [];
  const rnd = [];
  const rest = [];
  const rows = Math.ceil(2 / rowStep) + 2;
  for (let j = -rows / 2; j <= rows / 2; j += 1) {
    const offset = (Math.abs(j) % 2) * sp * 0.5;
    for (let i = -cols / 2 - 1; i <= cols / 2 + 1; i += 1) {
      const x = i * sp + offset + (random() - 0.5) * sp * 0.22;
      const y = j * rowStep + (random() - 0.5) * sp * 0.22;
      const radius = Math.hypot(x, y);
      const wobble = 0.012 * Math.sin(Math.atan2(y, x) * 7 + 1.3) + 0.008 * Math.sin(Math.atan2(y, x) * 13);
      const a = random();
      const b = random();
      if (radius > 0.95 + wobble + 0.05 * a) continue;
      home.push(x, y);
      rnd.push(a, b);
      const lean = Math.asin(Math.min(0.97, radius)) * 0.72 * (0.82 + 0.36 * random());
      const theta = Math.atan2(y, x) + (random() - 0.5) * 0.5;
      rest.push(theta, lean);
    }
  }
  return {
    count: home.length / 2,
    sp,
    home: new Float32Array(home),
    rnd: new Float32Array(rnd),
    rest: new Float32Array(rest),
  };
}

export function sampleTones(image, lattice, crop) {
  const res = 160;
  const canvas = document.createElement("canvas");
  canvas.width = res;
  canvas.height = res;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const iw = image.naturalWidth;
  const ih = image.naturalHeight;
  const side = crop ? crop[2] * Math.min(iw, ih) : Math.min(iw, ih);
  const sx = crop ? crop[0] * iw : (iw - side) / 2;
  const sy = crop ? crop[1] * ih : (ih - side) / 2;
  context.drawImage(image, sx, sy, side, side, 0, 0, res, res);
  const pixels = context.getImageData(0, 0, res, res).data;
  const lum = new Float32Array(res * res);
  for (let index = 0; index < res * res; index += 1) {
    const r = pixels[index * 4] / 255;
    const g = pixels[index * 4 + 1] / 255;
    const b = pixels[index * 4 + 2] / 255;
    lum[index] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  const blurred = boxBlur(boxBlur(lum, res, 7), res, 7);

  const read = (field, u, v) => {
    const x = Math.min(res - 1.001, Math.max(0, u * res - 0.5));
    const y = Math.min(res - 1.001, Math.max(0, v * res - 0.5));
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const i = y0 * res + x0;
    const top = field[i] * (1 - fx) + field[i + 1] * fx;
    const bottom = field[i + res] * (1 - fx) + field[i + res + 1] * fx;
    return top * (1 - fy) + bottom * fy;
  };

  const tones = new Float32Array(lattice.count);
  for (let index = 0; index < lattice.count; index += 1) {
    const x = lattice.home[index * 2];
    const y = lattice.home[index * 2 + 1];
    const u = (x + 1) / 2;
    const v = (y + 1) / 2;
    const l = read(lum, u, v);
    const soft = read(blurred, u, v);
    const crisp = Math.min(1, Math.max(0, l + (l - soft) * 0.7));
    const dark = 1 - crisp;
    let tone = Math.pow(smooth(0.1, 0.95, dark), 1.3);
    const radius = Math.hypot(x, y);
    tone *= 1 - smooth(0.84, 1.0, radius) * 0.72;
    const rim = 0.1 * smooth(0.78, 0.97, radius);
    tones[index] = Math.max(tone, rim);
  }
  return tones;
}

function boxBlur(source, res, radius) {
  const temp = new Float32Array(res * res);
  const out = new Float32Array(res * res);
  const span = radius * 2 + 1;
  for (let y = 0; y < res; y += 1) {
    let sum = 0;
    for (let k = -radius; k <= radius; k += 1) sum += source[y * res + Math.min(res - 1, Math.max(0, k))];
    for (let x = 0; x < res; x += 1) {
      temp[y * res + x] = sum / span;
      const add = Math.min(res - 1, x + radius + 1);
      const drop = Math.max(0, x - radius);
      sum += source[y * res + add] - source[y * res + drop];
    }
  }
  for (let x = 0; x < res; x += 1) {
    let sum = 0;
    for (let k = -radius; k <= radius; k += 1) sum += temp[Math.min(res - 1, Math.max(0, k)) * res + x];
    for (let y = 0; y < res; y += 1) {
      out[y * res + x] = sum / span;
      const add = Math.min(res - 1, y + radius + 1);
      const drop = Math.max(0, y - radius);
      sum += temp[add * res + x] - temp[drop * res + x];
    }
  }
  return out;
}
