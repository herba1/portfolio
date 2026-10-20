export const TUBES = [
  { id: "ultramarine", name: "Ultramarine", ryb: [0.02, 1, 0.04] },
  { id: "yellow", name: "Cadmium yellow", ryb: [0.25, 0.08, 0.85] },
  { id: "red", name: "Cadmium red", ryb: [1, 0.02, 0.16] },
  { id: "white", name: "Titanium white", ryb: [0, 0, 0] },
];

const CORNERS = [
  [1, 1, 1],
  [1, 0, 0],
  [0.12, 0.26, 0.58],
  [1, 1, 0],
  [1, 0.5, 0],
  [0, 0.66, 0.2],
  [0.5, 0, 0.5],
  [0.2, 0.094, 0],
];

export function rybToRgb([r, y, b]) {
  const w = [
    (1 - r) * (1 - y) * (1 - b),
    r * (1 - y) * (1 - b),
    (1 - r) * y * (1 - b),
    (1 - r) * (1 - y) * b,
    r * (1 - y) * b,
    (1 - r) * y * b,
    r * y * (1 - b),
    r * y * b,
  ];
  return [0, 1, 2].map((c) => w.reduce((sum, weight, i) => sum + weight * CORNERS[i][c], 0));
}

export function rybToCss(ryb) {
  const [r, g, b] = rybToRgb(ryb).map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255));
  return `rgb(${r} ${g} ${b})`;
}

function arc(cx, cy, rx, ry, from, to, count) {
  const points = [];
  for (let i = 0; i <= count; i += 1) {
    const a = from + ((to - from) * i) / count;
    points.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return points;
}

export const STUDY = [
  { tube: 1, mix: 0.62, width: 2.2, load: 0.8, points: [[-0.9, -0.42], [-0.3, -0.48], [0.3, -0.4], [0.92, -0.46]] },
  { tube: 1, mix: 0.55, width: 2.2, load: 0.8, points: [[0.9, -0.14], [0.3, -0.2], [-0.3, -0.12], [-0.92, -0.18]] },
  { tube: 1, mix: 0.5, width: 2.2, load: 0.75, points: [[-0.9, 0.14], [-0.2, 0.08], [0.4, 0.16], [0.92, 0.1]] },
  { tube: 1, mix: 0.45, width: 2.2, load: 0.7, points: [[0.9, 0.42], [0.2, 0.46], [-0.4, 0.38], [-0.92, 0.44]] },
  { tube: 0, mix: 0, width: 1, load: 1, points: arc(-0.46, 0.1, 0.25, 0.3, -Math.PI * 0.5, -Math.PI * 1.55, 16) },
  { tube: 0, mix: 0, width: 1, load: 1, points: arc(-0.46, 0.1, 0.25, 0.3, -Math.PI * 0.62, Math.PI * 0.55, 18) },
  { tube: 0, mix: 0, width: 1, load: 1, points: [[0.06, -0.14], [0.05, 0.2], [0.08, 0.42]] },
  { tube: 2, mix: 0, width: 0.5, load: 1, points: arc(0.06, -0.38, 0.026, 0.03, -Math.PI * 0.5, Math.PI * 1.6, 12) },
  { tube: 0, mix: 0, width: 1, load: 1, points: [[0.42, -0.62], [0.4, -0.1], [0.43, 0.3], [0.5, 0.42]] },
];
