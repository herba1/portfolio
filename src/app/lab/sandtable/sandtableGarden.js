export const PRESETS = [
  {
    key: "bone",
    label: "Bone",
    artist: "Louis the Child",
    cover: "/monovolt/louis-the-child.webp",
    crop: [0.16, 0, 0.6, 1],
    sand: [0.86, 0.815, 0.735],
    sandDeep: [0.74, 0.68, 0.585],
    swatch: "rgb(219 207 187)",
  },
  {
    key: "ochre",
    label: "Ochre",
    artist: "Cosmos Midnight",
    cover: "/monovolt/cosmos-midnight.webp",
    crop: [0.12, 0, 0.6, 1],
    sand: [0.8, 0.7, 0.565],
    sandDeep: [0.665, 0.56, 0.43],
    swatch: "rgb(204 178 144)",
  },
  {
    key: "ash",
    label: "Ash",
    artist: "LP Giobbi",
    cover: "/monovolt/lp-giobbi.webp",
    crop: [0.2, 0, 0.6, 1],
    sand: [0.6, 0.585, 0.56],
    sandDeep: [0.46, 0.445, 0.425],
    swatch: "rgb(152 148 142)",
  },
];

export const SAND = {
  depthPx: 12,
  periodPx: 16,
  talus: 0.72,
};

export function layoutGarden(bedW, bedH) {
  const short = Math.min(bedW, bedH);
  const side = Math.round(short * (bedW > bedH ? 0.58 : 0.6));
  const cornerX = bedW * (bedW > bedH ? 0.62 : 0.66);
  const cornerY = bedH * (bedW > bedH ? 0.36 : 0.34);
  const x = Math.max(short * 0.08, Math.min(bedW - side - short * 0.08, cornerX - side));
  const y = Math.max(short * 0.08, Math.min(bedH - side - short * 0.08, cornerY));
  const pitR = Math.max(30, short * (bedW > bedH ? 0.1 : 0.12));
  const pitX = x + side - pitR * 0.6;
  const pitY = y + pitR * 0.6;
  return { tile: [x, y, side, side], pit: [pitX, pitY, pitR], ring: Math.max(pitR * 2.6, short * 0.4) };
}

function hash(n) {
  const s = Math.sin(n * 127.1) * 43758.5453;
  return s - Math.floor(s);
}

function angleNoise(theta, seed) {
  let v = 0;
  for (let k = 1; k <= 4; k += 1) v += Math.sin(theta * (k + 1) + hash(seed + k) * 6.283) * (0.5 / k);
  return v;
}

function profile(phase) {
  const u = phase - Math.floor(phase);
  const s = 0.5 + 0.5 * Math.cos(u * Math.PI * 2);
  return Math.pow(s, 0.62);
}

export function gardenField(cellsX, cellsY, cellPx, bedW, bedH, mode = "garden") {
  const out = new Float32Array(cellsX * cellsY);
  const depth = SAND.depthPx;
  const period = SAND.periodPx;
  const { pit, ring } = layoutGarden(bedW, bedH);
  const [px, py, pr] = pit;
  const groove = 3.2;
  const crest = 1.5;
  for (let j = 0; j < cellsY; j += 1) {
    for (let i = 0; i < cellsX; i += 1) {
      const x = (i + 0.5) * cellPx;
      const y = (j + 0.5) * cellPx;
      let h = depth;
      if (mode === "flat") {
        h = depth + 0.18 * Math.sin(y * 0.9 + Math.sin(x * 0.013) * 3) + 0.1 * Math.sin(y * 2.3 + x * 0.004);
        out[j * cellsX + i] = h / cellPx;
        continue;
      }
      const dx = x - px;
      const dy = y - py;
      const rho = Math.hypot(dx, dy);
      const theta = Math.atan2(dy, dx);
      const edge = pr * (1 + 0.14 * angleNoise(theta, 3.1));
      let pattern;
      if (rho < ring) {
        const wobble = Math.sin(theta * 3 + rho * 0.011) * 1.4 + Math.sin(theta * 7 + 1.3) * 0.6;
        const phase = (rho - edge + wobble) / period - (5 * (theta + Math.PI)) / (Math.PI * 2);
        pattern = depth - groove + (groove + crest) * profile(phase);
        const lip = Math.exp(-Math.pow((rho - ring) / (period * 0.32), 2));
        pattern -= lip * groove * 0.9;
      } else {
        const wave = Math.sin(x / (bedW * 0.38) + 0.6) * period * 0.9 + Math.sin(x / (bedW * 0.13) + 2.1) * period * 0.12;
        const hand = Math.sin(x * 0.017 + y * 0.002) * 1.3 + Math.sin(x * 0.0061 + y * 0.0047) * 2.2;
        const phase = (y + wave + hand) / period;
        pattern = depth - groove + (groove + crest) * profile(phase);
        const join = Math.exp(-Math.pow((rho - ring - period * 0.5) / (period * 0.4), 2));
        pattern += join * crest * 1.1;
      }
      const wall = (rho - edge) * SAND.talus * 0.82;
      const rim = 4.2 * Math.exp(-Math.pow((rho - edge - period * 1.1) / (period * 0.9), 2)) * (0.75 + 0.25 * angleNoise(theta * 1.7, 9.4));
      const mess = Math.exp(-Math.pow(Math.max(0, rho - edge) / (period * 2.2), 2));
      h = pattern * (1 - mess) + (depth + rim) * mess;
      h = Math.min(h, Math.max(0, wall));
      out[j * cellsX + i] = Math.max(0, h) / cellPx;
    }
  }
  return out;
}
