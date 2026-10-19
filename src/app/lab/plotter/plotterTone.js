const MAX_SIDE = 900;

function boxBlur(source, width, height, radius) {
  if (radius < 1) return source;
  const temp = new Float32Array(source.length);
  const out = new Float32Array(source.length);
  const span = radius * 2 + 1;
  for (let y = 0; y < height; y += 1) {
    let sum = 0;
    const row = y * width;
    for (let k = -radius; k <= radius; k += 1) sum += source[row + Math.min(width - 1, Math.max(0, k))];
    for (let x = 0; x < width; x += 1) {
      temp[row + x] = sum / span;
      const add = Math.min(width - 1, x + radius + 1);
      const drop = Math.max(0, x - radius);
      sum += source[row + add] - source[row + drop];
    }
  }
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let k = -radius; k <= radius; k += 1) sum += temp[Math.min(height - 1, Math.max(0, k)) * width + x];
    for (let y = 0; y < height; y += 1) {
      out[y * width + x] = sum / span;
      const add = Math.min(height - 1, y + radius + 1);
      const drop = Math.max(0, y - radius);
      sum += temp[add * width + x] - temp[drop * width + x];
    }
  }
  return out;
}

function gaussish(source, width, height, radius) {
  let field = source;
  for (let i = 0; i < 3; i += 1) field = boxBlur(field, width, height, radius);
  return field;
}

function percentile(values, fraction) {
  const sample = [];
  const step = Math.max(1, Math.floor(values.length / 20000));
  for (let i = 0; i < values.length; i += step) sample.push(values[i]);
  sample.sort((a, b) => a - b);
  return sample[Math.min(sample.length - 1, Math.floor(fraction * sample.length))];
}

export function readTone(image, { levels = { low: 0.03, high: 0.995, gamma: 1.6, detail: 0.7 }, crop = [0, 0, 0, 0] } = {}) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const cropX = sourceWidth * crop[0];
  const cropY = sourceHeight * crop[1];
  const cropW = sourceWidth * (1 - crop[0] - crop[2]);
  const cropH = sourceHeight * (1 - crop[1] - crop[3]);
  const scale = Math.min(1, MAX_SIDE / Math.max(cropW, cropH));
  const width = Math.max(8, Math.round(cropW * scale));
  const height = Math.max(8, Math.round(cropH * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, cropX, cropY, cropW, cropH, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const count = width * height;
  const dark = new Float32Array(count);
  const warm = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const r = pixels[i * 4] / 255;
    const g = pixels[i * 4 + 1] / 255;
    const b = pixels[i * 4 + 2] / 255;
    dark[i] = 1 - (0.2126 * r + 0.7152 * g + 0.0722 * b);
    const lift = r - Math.max(g * 0.92, b);
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    warm[i] = Math.max(0, Math.min(1, (lift - 0.12) * 2.6)) * Math.min(1, chroma * 2.2);
  }
  const unitEarly = Math.max(width, height) / 760;
  const broad = gaussish(dark, width, height, Math.max(4, Math.round(14 * unitEarly)));
  const plain = new Float32Array(count);
  const lowPlain = percentile(dark, levels.low);
  const highPlain = percentile(dark, levels.high);
  for (let i = 0; i < count; i += 1) {
    plain[i] = Math.pow(Math.max(0, Math.min(1, (dark[i] - lowPlain) / Math.max(0.05, highPlain - lowPlain))), levels.gamma);
    dark[i] = dark[i] + (dark[i] - broad[i]) * levels.detail;
  }
  const low = percentile(dark, levels.low);
  const high = percentile(dark, levels.high);
  const span = Math.max(0.05, high - low);
  for (let i = 0; i < count; i += 1) {
    const v = Math.max(0, Math.min(1, (dark[i] - low) / span));
    dark[i] = Math.pow(v, levels.gamma);
  }
  const unit = Math.max(width, height) / 760;
  const fine = gaussish(dark, width, height, Math.max(1, Math.round(1.2 * unit)));
  const soft = gaussish(plain, width, height, Math.max(2, Math.round(3.4 * unit)));
  const warmFine = gaussish(warm, width, height, Math.max(1, Math.round(1.6 * unit)));
  const warmSoft = gaussish(warm, width, height, Math.max(2, Math.round(4 * unit)));
  const data = new Float32Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    data[i * 4] = fine[i];
    data[i * 4 + 1] = soft[i];
    data[i * 4 + 2] = warmFine[i];
    data[i * 4 + 3] = warmSoft[i];
  }
  return { width, height, data, aspect: width / height };
}
