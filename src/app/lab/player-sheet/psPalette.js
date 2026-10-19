const FALLBACK = { colors: [[214, 120, 80], [90, 120, 200], [230, 200, 120], [120, 90, 160]] };

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

function toHsl([r, g, b]) {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  h /= 6;
  return [h, s, l];
}

function fromHsl([h, s, l]) {
  if (!s) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t) => {
    let x = t;
    if (x < 0) x += 1;
    if (x > 1) x -= 1;
    if (x < 1 / 6) return p + (q - p) * 6 * x;
    if (x < 1 / 2) return q;
    if (x < 2 / 3) return p + (q - p) * (2 / 3 - x) * 6;
    return p;
  };
  return [hue(h + 1 / 3) * 255, hue(h) * 255, hue(h - 1 / 3) * 255];
}

const luminance = (c) => {
  const lin = (v) => {
    const x = v / 255;
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
};

const atLuminance = (h, s, target) => {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 18; i += 1) {
    const mid = (lo + hi) / 2;
    if (luminance(fromHsl([h, s, mid])) < target) lo = mid;
    else hi = mid;
  }
  return fromHsl([h, s, lo]);
};

export function tone(colors) {
  const tones = colors.map((c) => toHsl(c));
  const pick = tones.find(([h, s]) => s >= 0.18 && (h < 0.11 || h > 0.24)) || tones.find(([, s]) => s >= 0.18);
  if (!pick) return [46, 48, 52];
  return atLuminance(pick[0], Math.min(0.5, Math.max(0.32, pick[1])), 0.07);
}

export const css = (c) => `rgb(${Math.round(c[0])} ${Math.round(c[1])} ${Math.round(c[2])})`;

export function readPalette(src) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const n = 40;
        const canvas = document.createElement("canvas");
        canvas.width = n;
        canvas.height = n;
        const g = canvas.getContext("2d", { willReadFrequently: true });
        g.drawImage(img, 0, 0, n, n);
        const data = g.getImageData(0, 0, n, n).data;
        const buckets = new Map();
        for (let i = 0; i < data.length; i += 4) {
          const key = ((data[i] >> 5) << 6) | ((data[i + 1] >> 5) << 3) | (data[i + 2] >> 5);
          const e = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
          e.r += data[i];
          e.g += data[i + 1];
          e.b += data[i + 2];
          e.n += 1;
          buckets.set(key, e);
        }
        const ranked = [...buckets.values()]
          .map((e) => {
            const rgb = [e.r / e.n, e.g / e.n, e.b / e.n];
            const [, s, l] = toHsl(rgb);
            return { rgb, score: e.n * (0.12 + s) * (0.3 + Math.min(l, 1 - l)) };
          })
          .sort((a, b) => b.score - a.score);
        const picked = [];
        for (const e of ranked) {
          if (picked.every((p) => distance(p, e.rgb) > 64)) picked.push(e.rgb);
          if (picked.length === 4) break;
        }
        while (picked.length < 4) picked.push(picked[picked.length - 1] || FALLBACK.colors[picked.length]);
        resolve({ colors: picked });
      } catch {
        resolve(FALLBACK);
      }
    };
    img.onerror = () => resolve(FALLBACK);
    img.src = src;
  });
}
