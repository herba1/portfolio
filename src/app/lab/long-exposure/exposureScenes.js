export const PHOTO_SRC = "/monovolt/abt6.webp";

export const LIGHTS = [
  { id: "rose", label: "Rose", rgb: [1.0, 0.12, 0.4], swatch: "rgb(255 92 156)" },
  { id: "amber", label: "Amber", rgb: [1.0, 0.36, 0.06], swatch: "rgb(255 160 64)" },
  { id: "ice", label: "Ice", rgb: [0.16, 0.56, 1.0], swatch: "rgb(120 196 255)" },
];

export const LAMPS = [
  { at: [0.552, 0.062], r: 0.0062, w: 7.0, tint: [1.0, 0.82, 0.62], beat: 0.7 },
  { at: [0.284, 0.122], r: 0.0052, w: 5.5, tint: [1.0, 0.22, 0.62], beat: 1.9 },
  { at: [0.662, 0.152], r: 0.0048, w: 5.0, tint: [0.38, 0.5, 1.0], beat: 2.6 },
  { at: [0.884, 0.146], r: 0.0052, w: 5.0, tint: [0.7, 0.3, 1.0], beat: 1.3 },
  { at: [0.04, 0.118], r: 0.006, w: 3.4, tint: [1.0, 0.18, 0.12], beat: 3.1 },
  { at: [0.42, 0.205], r: 0.0035, w: 2.2, tint: [0.5, 0.9, 1.0], beat: 0.4 },
];

function tremor(t, seed) {
  return [
    0.0024 * Math.sin(t * 41 + seed) + 0.0014 * Math.sin(t * 83 + seed * 2.3),
    0.0024 * Math.sin(t * 37 + seed * 1.7) + 0.0014 * Math.sin(t * 71 + seed * 0.6),
  ];
}

function coil(u) {
  const turns = 5.5;
  const a = Math.PI * 2 * turns * u;
  const swell = 0.75 + 0.25 * Math.sin(Math.PI * u);
  return [0.13 + 0.74 * u + 0.075 * Math.cos(a + Math.PI) * swell, 0.36 + 0.11 * Math.sin(a) * swell];
}

function infinity(u) {
  const a = Math.PI * 2 * u * 1.5 - Math.PI * 0.5;
  return [0.5 + 0.34 * Math.cos(a), 0.52 + 0.12 * Math.sin(a * 2) + 0.02 * Math.sin(u * 9)];
}

function spiral(u) {
  const a = Math.PI * 2 * 2.3 * u + 0.4;
  const r = 0.26 - 0.17 * u;
  return [0.5 + r * Math.cos(a), 0.42 + r * 1.05 * Math.sin(a)];
}

function wave(u) {
  const a = Math.PI * 2 * 3 * u;
  return [0.1 + 0.8 * u, 0.62 - 0.1 * Math.sin(a) * (0.3 + 0.7 * u) - 0.06 * u];
}

export const FIGURES = { coil, infinity, spiral, wave };

export function figurePath(name, seconds, seed = 0) {
  const fn = FIGURES[name] || coil;
  return (t) => {
    const raw = Math.min(1, Math.max(0, t / seconds));
    const u = raw + 0.025 * Math.sin(raw * Math.PI * 6 + seed) * Math.sin(raw * Math.PI);
    const [x, y] = fn(Math.min(1, Math.max(0, u)));
    const [jx, jy] = tremor(t, seed);
    return [x + jx, y + jy];
  };
}

export const SEED_SHOTS = [
  { strokes: [{ figure: "spiral", light: 2, from: 0.6, seconds: 4.2 }], seconds: 6.4 },
  { strokes: [{ figure: "wave", light: 1, from: 0.4, seconds: 3.6 }], seconds: 5.1 },
  {
    strokes: [
      { figure: "infinity", light: 1, from: 0.5, seconds: 4.4 },
      { figure: "coil", light: 0, from: 5.2, seconds: 3.4 },
    ],
    seconds: 9.6,
  },
];

export const AUTO_FIGURES = ["coil", "infinity", "spiral", "wave"];
