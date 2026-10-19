function hsl(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h;
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return [h * 60, s, l];
}

const STOPS = [
  [0, 31],
  [0.3, 27],
  [0.55, 22],
  [0.8, 17],
  [1, 13],
];

export function palette(h, s) {
  return {
    h,
    s,
    bg: `hsl(${h} ${s}% 30%)`,
    glow: `hsl(${h} ${Math.min(90, s + 12)}% 60%)`,
    soft: `hsl(${h} ${Math.min(50, s)}% 84%)`,
    stops: STOPS.map(([at, l]) => [at, `hsl(${h} ${s}% ${l}%)`]),
  };
}

const cache = new Map();

export function coverColor(src) {
  if (cache.has(src)) return cache.get(src);
  const job = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const c = document.createElement("canvas");
        c.width = 24;
        c.height = 24;
        const g = c.getContext("2d", { willReadFrequently: true });
        g.drawImage(img, 0, 0, 24, 24);
        const px = g.getImageData(0, 0, 24, 24).data;
        let best = null;
        let score = -1;
        for (let i = 0; i < px.length; i += 4) {
          const [h, s, l] = hsl(px[i], px[i + 1], px[i + 2]);
          const sc = s * (1 - Math.abs(l - 0.5) * 1.6);
          if (sc > score) {
            score = sc;
            best = [h, s, l];
          }
        }
        const [h, s] = best || [30, 0, 0.5];
        const sat = Math.round(Math.min(0.78, s) * 100 * (score < 0.12 ? 0.15 : 1));
        resolve(palette(Math.round(h), sat));
      } catch {
        resolve(palette(30, 10));
      }
    };
    img.onerror = () => resolve(palette(30, 10));
    img.src = src;
  });
  cache.set(src, job);
  return job;
}
