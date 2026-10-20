const toHsl = (r, g, b) => {
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
};

export function readSleeve(img) {
  const n = 24;
  const canvas = document.createElement("canvas");
  canvas.width = n;
  canvas.height = n;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, n, n);
  const { data } = ctx.getImageData(0, 0, n, n);
  const bins = Array.from({ length: 12 }, () => ({ w: 0, h: 0, s: 0 }));
  for (let i = 0; i < data.length; i += 4) {
    const [h, s, l] = toHsl(data[i] / 255, data[i + 1] / 255, data[i + 2] / 255);
    if (s < 0.24 || l < 0.1 || l > 0.92) continue;
    const w = s * (1 - Math.abs(l - 0.5) * 1.5);
    const bin = bins[Math.floor(h / 30) % 12];
    bin.w += w;
    bin.h += h * w;
    bin.s += s * w;
  }
  const best = bins.reduce((a, b) => (b.w > a.w ? b : a));
  if (best.w < n * n * 0.02) return "hsl(30 4% 13%)";
  const hue = Math.round(best.h / best.w);
  const sat = Math.round(Math.min(0.62, best.s / best.w) * 80);
  const light = hue >= 40 && hue <= 170 ? 15 : 19;
  return `hsl(${hue} ${sat}% ${light}%)`;
}
