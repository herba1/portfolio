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
      sum += source[row + Math.min(width - 1, x + radius + 1)] - source[row + Math.max(0, x - radius)];
    }
  }
  for (let x = 0; x < width; x += 1) {
    let sum = 0;
    for (let k = -radius; k <= radius; k += 1) sum += temp[Math.min(height - 1, Math.max(0, k)) * width + x];
    for (let y = 0; y < height; y += 1) {
      out[y * width + x] = sum / span;
      sum += temp[Math.min(height - 1, y + radius + 1) * width + x] - temp[Math.max(0, y - radius) * width + x];
    }
  }
  return out;
}

function blur(source, width, height, radius) {
  let field = source;
  for (let i = 0; i < 3; i += 1) field = boxBlur(field, width, height, radius);
  return field;
}

export function readTone(image) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(image, 0, 0, width, height);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const count = width * height;
  const luma = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    luma[i] = (0.299 * pixels[i * 4] + 0.587 * pixels[i * 4 + 1] + 0.114 * pixels[i * 4 + 2]) / 255;
  }
  const sorted = Array.from(luma).sort((a, b) => a - b);
  const low = sorted[Math.floor(count * 0.01)];
  const high = sorted[Math.floor(count * 0.995)];
  for (let i = 0; i < count; i += 1) luma[i] = Math.max(0, Math.min(1, (luma[i] - low) / Math.max(0.05, high - low)));
  const bins = new Float32Array(256);
  for (let i = 0; i < count; i += 1) bins[Math.min(255, Math.floor(luma[i] * 255))] += 1;
  const cdf = new Float32Array(256);
  let run = 0;
  for (let i = 0; i < 256; i += 1) {
    run += bins[i];
    cdf[i] = run / count;
  }
  for (let i = 0; i < count; i += 1) {
    const v = luma[i];
    luma[i] = v * 0.3 + cdf[Math.min(255, Math.floor(v * 255))] * 0.7;
  }
  const broad = blur(luma, width, height, 10);
  const sharp = blur(luma, width, height, 2);
  const shade = new Float32Array(count);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const dx = (x / width - 0.6) / 0.46;
      const dy = (y / height - 0.5) / 0.62;
      const d = Math.sqrt(dx * dx + dy * dy);
      const t = Math.max(0, Math.min(1, (d - 0.8) / 0.35));
      const calm = t * t * (3 - 2 * t);
      const i = y * width + x;
      shade[i] = sharp[i] + (broad[i] * 0.85 + 0.04 - sharp[i]) * calm;
    }
  }
  const edgeSource = blur(luma, width, height, 3);
  const border = new Float32Array(count);
  let peak = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const i = y * width + x;
      const gx =
        edgeSource[i - width + 1] + 2 * edgeSource[i + 1] + edgeSource[i + width + 1] -
        edgeSource[i - width - 1] - 2 * edgeSource[i - 1] - edgeSource[i + width - 1];
      const gy =
        edgeSource[i + width - 1] + 2 * edgeSource[i + width] + edgeSource[i + width + 1] -
        edgeSource[i - width - 1] - 2 * edgeSource[i - width] - edgeSource[i - width + 1];
      border[i] = Math.hypot(gx, gy);
      peak = Math.max(peak, border[i]);
    }
  }
  const scale = 1 / Math.max(0.0001, peak * 0.55);
  const softBorder = blur(border, width, height, 1);
  const data = new Float32Array(count * 4);
  for (let i = 0; i < count; i += 1) {
    data[i * 4] = shade[i];
    data[i * 4 + 1] = Math.min(1, softBorder[i] * scale);
    data[i * 4 + 2] = 0;
    data[i * 4 + 3] = 1;
  }
  return { width, height, data, aspect: width / height };
}
