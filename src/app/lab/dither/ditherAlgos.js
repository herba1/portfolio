const BAYER = (() => {
  const m = [[0]];
  let size = 1;
  let cur = m;
  while (size < 8) {
    const next = [];
    for (let y = 0; y < size * 2; y += 1) {
      next.push([]);
      for (let x = 0; x < size * 2; x += 1) {
        const base = cur[y % size][x % size] * 4;
        const q = (y < size ? 0 : 2) + (x < size ? 0 : 1);
        next[y].push(base + [0, 2, 3, 1][q]);
      }
    }
    cur = next;
    size *= 2;
  }
  return cur.map((row) => row.map((v) => (v + 0.5) / 64));
})();

export const METHODS = [
  { id: "threshold", label: "Threshold" },
  { id: "bayer", label: "Bayer" },
  { id: "floyd", label: "Floyd–Steinberg" },
  { id: "atkinson", label: "Atkinson" },
];

export function lumaFrom(img, n) {
  const c = document.createElement("canvas");
  c.width = n;
  c.height = n;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.imageSmoothingQuality = "high";
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const side = Math.min(iw, ih);
  x.drawImage(img, (iw - side) / 2, (ih - side) / 2, side, side, 0, 0, n, n);
  const src = x.getImageData(0, 0, n, n).data;
  const base = new Float32Array(n * n);
  for (let i = 0; i < n * n; i += 1) base[i] = Math.pow((0.2126 * src[i * 4] + 0.7152 * src[i * 4 + 1] + 0.0722 * src[i * 4 + 2]) / 255, 1.1);
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y += 1) {
    for (let xx = 0; xx < n; xx += 1) {
      let blur = 0;
      let count = 0;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          const yy = y + dy;
          const xk = xx + dx;
          if (yy < 0 || yy >= n || xk < 0 || xk >= n) continue;
          blur += base[yy * n + xk];
          count += 1;
        }
      }
      const i = y * n + xx;
      out[i] = base[i] + (base[i] - blur / count) * 0.6;
    }
  }
  return out;
}

export function applyContrast(luma, contrast, out) {
  for (let i = 0; i < luma.length; i += 1) {
    const v = (luma[i] - 0.5) * contrast + 0.5 + (contrast - 1) * 0.04;
    out[i] = v < 0 ? 0 : v > 1 ? 1 : v;
  }
  return out;
}

export function dither(method, lum, n) {
  const out = new Uint8Array(n * n);
  if (method === "threshold") {
    for (let i = 0; i < n * n; i += 1) out[i] = lum[i] > 0.5 ? 1 : 0;
    return out;
  }
  if (method === "bayer") {
    for (let y = 0; y < n; y += 1) {
      const row = BAYER[y & 7];
      for (let x = 0; x < n; x += 1) out[y * n + x] = lum[y * n + x] > row[x & 7] ? 1 : 0;
    }
    return out;
  }
  const buf = Float32Array.from(lum);
  if (method === "floyd") {
    for (let y = 0; y < n; y += 1) {
      const ltr = y % 2 === 0;
      for (let k = 0; k < n; k += 1) {
        const x = ltr ? k : n - 1 - k;
        const i = y * n + x;
        const v = buf[i] > 0.5 ? 1 : 0;
        out[i] = v;
        const e = buf[i] - v;
        const dir = ltr ? 1 : -1;
        if (x + dir >= 0 && x + dir < n) buf[i + dir] += (e * 7) / 16;
        if (y + 1 < n) {
          if (x - dir >= 0 && x - dir < n) buf[i + n - dir] += (e * 3) / 16;
          buf[i + n] += (e * 5) / 16;
          if (x + dir >= 0 && x + dir < n) buf[i + n + dir] += e / 16;
        }
      }
    }
    return out;
  }
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      const i = y * n + x;
      const v = buf[i] > 0.5 ? 1 : 0;
      out[i] = v;
      const e = (buf[i] - v) / 8;
      if (x + 1 < n) buf[i + 1] += e;
      if (x + 2 < n) buf[i + 2] += e;
      if (y + 1 < n) {
        if (x > 0) buf[i + n - 1] += e;
        buf[i + n] += e;
        if (x + 1 < n) buf[i + n + 1] += e;
      }
      if (y + 2 < n) buf[i + n * 2] += e;
    }
  }
  return out;
}
