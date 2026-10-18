const SIZE = 48;
const K = 6;

const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function rgbToOklab(r, g, b) {
  const lr = toLinear(r / 255);
  const lg = toLinear(g / 255);
  const lb = toLinear(b / 255);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

const toLch = ([L, a, b]) => {
  const C = Math.hypot(a, b);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return { L, C, h };
};

const dist2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;

function kmeans(points) {
  const n = points.length;
  const centers = [];
  let mean = [0, 0, 0];
  for (const p of points) mean = [mean[0] + p[0] / n, mean[1] + p[1] / n, mean[2] + p[2] / n];
  let first = 0;
  let best = Infinity;
  points.forEach((p, i) => {
    const d = dist2(p, mean);
    if (d < best) {
      best = d;
      first = i;
    }
  });
  centers.push(points[first]);
  while (centers.length < K) {
    let far = 0;
    let farD = -1;
    points.forEach((p, i) => {
      let d = Infinity;
      for (const c of centers) d = Math.min(d, dist2(p, c));
      if (d > farD) {
        farD = d;
        far = i;
      }
    });
    centers.push(points[far]);
  }
  const assign = new Int32Array(n);
  let counts = new Array(K).fill(0);
  for (let iter = 0; iter < 10; iter += 1) {
    counts = new Array(K).fill(0);
    const sums = centers.map(() => [0, 0, 0]);
    points.forEach((p, i) => {
      let bi = 0;
      let bd = Infinity;
      centers.forEach((c, ci) => {
        const d = dist2(p, c);
        if (d < bd) {
          bd = d;
          bi = ci;
        }
      });
      assign[i] = bi;
      counts[bi] += 1;
      sums[bi][0] += p[0];
      sums[bi][1] += p[1];
      sums[bi][2] += p[2];
    });
    centers.forEach((c, ci) => {
      if (!counts[ci]) return;
      centers[ci] = [sums[ci][0] / counts[ci], sums[ci][1] / counts[ci], sums[ci][2] / counts[ci]];
    });
  }
  return centers
    .map((c, i) => ({ ...toLch(c), share: counts[i] / n }))
    .filter((c) => c.share > 0.01)
    .sort((a, b) => b.share - a.share);
}

export function extractPalette(img) {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, SIZE, SIZE);
  const { data } = ctx.getImageData(0, 0, SIZE, SIZE);
  const points = [];
  for (let i = 0; i < data.length; i += 4) points.push(rgbToOklab(data[i], data[i + 1], data[i + 2]));
  return kmeans(points);
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const hueGap = (a, b) => {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
};

export function deriveTheme(swatches) {
  const base = swatches[0];
  const bgL = clamp(base.L, 0.3, 0.9);
  const dark = bgL < 0.62;
  const bgC = Math.min(base.C, 0.15);
  const h = base.h;
  const bg = { L: bgL, C: bgC, h };
  const raised = { L: clamp(bgL + (dark ? 0.06 : 0.045), 0, 0.98), C: bgC * 0.85, h };
  const line = { L: clamp(bgL + (dark ? 0.14 : -0.12), 0, 1), C: bgC * 0.7, h };
  const ink = { L: dark ? 0.98 : 0.2, C: Math.min(0.025, bgC), h };
  const ink2 = { L: dark ? 0.84 : 0.4, C: Math.min(0.05, bgC), h };
  const candidates = swatches.slice(1).filter((s) => s.C > 0.05 && (hueGap(s.h, h) > 28 || Math.abs(s.L - bgL) > 0.3 || bgC < 0.04));
  candidates.sort((a, b) => b.C * b.share ** 0.3 - a.C * a.share ** 0.3);
  const pick = candidates[0] ?? { L: dark ? 0.9 : 0.25, C: Math.min(0.04, bgC), h };
  const accentL = dark ? Math.max(pick.L, 0.74) : Math.min(pick.L, 0.52);
  const accent = { L: accentL, C: pick.C > 0.05 ? clamp(pick.C * 1.15, 0.12, 0.22) : pick.C, h: pick.h };
  const onAccent = accentL > 0.66 ? { L: 0.2, C: 0.02, h: pick.h } : { L: 0.99, C: 0.01, h: pick.h };
  const blobs = [0, 1, 2, 3].map((i) => {
    const s = swatches[i % swatches.length];
    return { L: clamp(s.L, 0.25, 0.92), C: Math.min(s.C * 1.2, 0.24), h: s.h };
  });
  return { dark, roles: { bg, raised, line, ink, ink2, accent, onaccent: onAccent, b0: blobs[0], b1: blobs[1], b2: blobs[2], b3: blobs[3] } };
}

export const ROLES = ["bg", "raised", "line", "ink", "ink2", "accent", "onaccent", "b0", "b1", "b2", "b3"];

export const fmt = (c) => `oklch(${c.L.toFixed(2)} ${c.C.toFixed(3)} ${Math.round(c.h)})`;
