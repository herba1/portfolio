import { sectionAt } from "./wsTracks";

const RATE = 40;

function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const hash = (str) => {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) h = Math.imul(h ^ str.charCodeAt(i), 16777619);
  return h >>> 0;
};

export function buildPeaks(track) {
  const n = Math.ceil(track.duration * RATE);
  const peaks = new Float32Array(n);
  const rand = rng(hash(track.id));
  const beat = 60 / track.bpm;
  let slow = 0.5;
  for (let i = 0; i < n; i += 1) {
    const t = i / RATE;
    const si = sectionAt(t, track.sections);
    const sec = track.sections[si];
    const end = si + 1 < track.sections.length ? track.sections[si + 1].start : track.duration;
    const k = Math.min(1, Math.max(0, (t - sec.start) / Math.max(0.01, end - sec.start)));
    const shaped = sec.to > sec.from ? k * k : 1 - (1 - k) * (1 - k);
    const env = sec.from + (sec.to - sec.from) * shaped;
    slow += (rand() - 0.5) * 0.08;
    slow = Math.min(1, Math.max(0.2, slow * 0.98 + 0.5 * 0.02));
    const phase = (t % beat) / beat;
    const hit = Math.exp(-phase * 7) * 0.45 + Math.exp(-((phase + 0.5) % 1) * 9) * 0.18;
    const fizz = rand();
    const v = env * (0.38 + 0.3 * slow + 0.32 * hit) * (0.72 + 0.28 * fizz);
    const edge = Math.min(1, t * 4, (track.duration - t) * 2);
    peaks[i] = Math.min(1, Math.max(0.015, v * edge));
  }
  return { peaks, rate: RATE };
}

export function readColumns(src, count) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const h = 48;
        const canvas = document.createElement("canvas");
        canvas.width = count;
        canvas.height = h;
        const g = canvas.getContext("2d", { willReadFrequently: true });
        g.drawImage(img, 0, 0, count, h);
        const data = g.getImageData(0, 0, count, h).data;
        const cols = [];
        for (let x = 0; x < count; x += 1) {
          let best = null;
          let bestScore = -1;
          let r = 0;
          let gg = 0;
          let b = 0;
          for (let y = 0; y < h; y += 1) {
            const o = (y * count + x) * 4;
            r += data[o];
            gg += data[o + 1];
            b += data[o + 2];
            const mx = Math.max(data[o], data[o + 1], data[o + 2]);
            const mn = Math.min(data[o], data[o + 1], data[o + 2]);
            const score = mx ? (mx - mn) / mx : 0;
            if (score > bestScore) {
              bestScore = score;
              best = [data[o], data[o + 1], data[o + 2]];
            }
          }
          const avg = [r / h, gg / h, b / h];
          cols.push(bestScore > 0.25 ? best.map((v, i) => v * 0.6 + avg[i] * 0.4) : avg);
        }
        resolve(cols);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
