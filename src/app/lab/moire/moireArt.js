const MAX_SIDE = 720;

function surface(rw, rh) {
  const scale = Math.min(1, MAX_SIDE / Math.max(rw, rh));
  const w = Math.max(8, Math.round(rw * scale));
  const h = Math.max(8, Math.round(rh * scale));
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, x: c.getContext("2d", { willReadFrequently: true }), w, h, scale };
}

function blurred(src, w, h, radius) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.filter = `blur(${radius.toFixed(2)}px)`;
  x.drawImage(src, 0, 0);
  return x.getImageData(0, 0, w, h).data;
}

function layouts(text) {
  const words = text.split(/\s+/).filter(Boolean);
  const out = [[words.join(" ")]];
  for (let a = 1; a < words.length; a += 1) {
    out.push([words.slice(0, a).join(" "), words.slice(a).join(" ")]);
    for (let b = a + 1; b < words.length; b += 1) out.push([words.slice(0, a).join(" "), words.slice(a, b).join(" "), words.slice(b).join(" ")]);
  }
  return out;
}

export function wordImage(text, region, period) {
  const s = surface(region.w, region.h);
  const { x, w, h } = s;
  x.font = "700 100px MoireSans, Arial, sans-serif";
  const maxW = w * 0.92;
  const maxH = h * 0.8;
  let lines = [text];
  let size = 0;
  for (const option of layouts(text)) {
    const widest = Math.max(...option.map((l) => x.measureText(l).width));
    const s0 = Math.min((100 * maxW) / widest, maxH / (option.length * 0.96), h * 0.5) * (option.length > 1 ? 0.97 : 1);
    if (s0 > size * 1.04) {
      size = s0;
      lines = option;
    }
  }
  x.font = `700 ${size}px MoireSans, Arial, sans-serif`;
  x.fillStyle = "#fff";
  x.textAlign = "center";
  x.textBaseline = "middle";
  const lh = size * 0.96;
  const cy = h / 2 - ((lines.length - 1) * lh) / 2 + size * 0.03;
  lines.forEach((l, i) => x.fillText(l, w / 2, cy + i * lh));
  const px = blurred(s.c, w, h, period * 1.7 * s.scale);
  const data = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) data[i] = px[i * 4 + 3];
  return { data, w, h, rect: [region.x, region.y, region.w, region.h] };
}

export function coverImage(img, region, period, { crop = [0, 0, 1, 1], invert = true, gamma = 1 } = {}) {
  const iw = img.naturalWidth;
  const ih = img.naturalHeight;
  const sw = crop[2] * iw;
  const sh = crop[3] * ih;
  const fit = Math.min(region.w / sw, region.h / sh) * 0.96;
  const dw = sw * fit;
  const dh = sh * fit;
  const rect = [region.x + (region.w - dw) / 2, region.y + (region.h - dh) / 2, dw, dh];
  const s = surface(dw, dh);
  const { x, w, h } = s;
  x.imageSmoothingEnabled = true;
  x.imageSmoothingQuality = "high";
  x.drawImage(img, crop[0] * iw, crop[1] * ih, sw, sh, 0, 0, w, h);
  const px = blurred(s.c, w, h, period * 1.1 * s.scale);
  const lum = new Float32Array(w * h);
  const sorted = [];
  for (let i = 0; i < w * h; i += 1) {
    const v = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
    lum[i] = v;
    if (i % 7 === 0) sorted.push(v);
  }
  sorted.sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.03)];
  const hi = sorted[Math.floor(sorted.length * 0.97)];
  const data = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) {
    let v = Math.min(1, Math.max(0, (lum[i] - lo) / Math.max(0.05, hi - lo)));
    v = Math.pow(v, gamma);
    if (invert) v = 1 - v;
    data[i] = Math.round(v * 255);
  }
  return { data, w, h, rect };
}
