function bezier(a, b, c, d, steps) {
  const out = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const u = 1 - t;
    const w0 = u * u * u;
    const w1 = 3 * u * u * t;
    const w2 = 3 * u * t * t;
    const w3 = t * t * t;
    out.push([a[0] * w0 + b[0] * w1 + c[0] * w2 + d[0] * w3, a[1] * w0 + b[1] * w1 + c[1] * w2 + d[1] * w3]);
  }
  return out;
}

function chain(...parts) {
  const out = [];
  parts.forEach((part, i) => out.push(...(i === 0 ? part : part.slice(1))));
  return out;
}

function ellipse(cx, cy, rx, ry, from, to, steps) {
  const out = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = from + ((to - from) * i) / steps;
    out.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return out;
}

const SIDE_B = [
  chain(
    bezier([0.64, -0.84], [0.46, -1.1], [0.02, -1.02], [0.08, -0.72], 10),
    bezier([0.08, -0.72], [0.14, -0.46], [0.66, -0.5], [0.64, -0.2], 10),
    bezier([0.64, -0.2], [0.62, 0.08], [0.12, 0.08], [0.0, -0.12], 10),
  ),
  bezier([0.98, -0.96], [0.97, -0.6], [0.96, -0.3], [0.95, 0.0], 8),
  [
    [0.99, -1.42],
    [1.0, -1.4],
  ],
  chain(ellipse(1.66, -0.5, 0.44, 0.52, -0.25, -0.25 - Math.PI * 2, 30)),
  bezier([2.12, -1.92], [2.11, -1.2], [2.1, -0.6], [2.12, 0.02], 14),
  chain(
    bezier([2.46, -0.5], [2.66, -0.52], [2.88, -0.54], [3.08, -0.56], 6),
    bezier([3.08, -0.56], [3.1, -1.06], [2.44, -1.1], [2.42, -0.52], 12),
    bezier([2.42, -0.52], [2.4, 0.06], [2.92, 0.1], [3.12, -0.16], 12),
  ),
  bezier([3.96, -1.92], [3.95, -1.2], [3.96, -0.6], [3.95, 0.02], 14),
  chain(
    bezier([3.96, -1.9], [4.86, -2.02], [4.9, -0.98], [3.98, -1.0], 14),
    bezier([3.98, -1.0], [5.02, -1.02], [5.06, 0.08], [3.95, 0.02], 16),
  ),
];

const HI = [
  bezier([0.06, -1.92], [0.05, -1.2], [0.04, -0.6], [0.05, 0.02], 14),
  chain(bezier([0.05, -0.5], [0.2, -1.08], [0.76, -1.08], [0.74, -0.46], 12), bezier([0.74, -0.46], [0.73, -0.3], [0.73, -0.14], [0.74, 0.02], 6)),
  bezier([1.12, -0.96], [1.11, -0.6], [1.11, -0.3], [1.1, 0.02], 8),
  [
    [1.14, -1.42],
    [1.15, -1.4],
  ],
];

export const WORDS = { sideB: SIDE_B, hi: HI };

function bounds(strokes) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const s of strokes) {
    for (const [x, y] of s) {
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, maxX, minY, maxY };
}

export function layoutWord(word, cx, cy, width, seed = 1) {
  const strokes = WORDS[word] || SIDE_B;
  const b = bounds(strokes);
  const scale = width / (b.maxX - b.minX);
  const midX = (b.minX + b.maxX) / 2;
  const midY = (b.minY + b.maxY) / 2;
  const slant = 0.14;
  const tilt = -0.05;
  const cos = Math.cos(tilt);
  const sin = Math.sin(tilt);
  return strokes.map((stroke, si) =>
    stroke.map(([x, y], i) => {
      const jx = Math.sin(i * 1.7 + si * 3.1 + seed) * 0.012 + Math.sin(i * 0.43 + seed * 2.3) * 0.02;
      const jy = Math.sin(i * 1.3 + si * 1.9 + seed * 0.7) * 0.012;
      const lx = (x - midX + jx - (y - midY) * slant) * scale;
      const ly = (y - midY + jy) * scale;
      return [cx + lx * cos - ly * sin, cy + lx * sin + ly * cos];
    }),
  );
}

export function strokeLength(stroke) {
  let total = 0;
  for (let i = 1; i < stroke.length; i += 1) total += Math.hypot(stroke[i][0] - stroke[i - 1][0], stroke[i][1] - stroke[i - 1][1]);
  return total;
}

export function pointAlong(stroke, distance) {
  let left = distance;
  for (let i = 1; i < stroke.length; i += 1) {
    const [ax, ay] = stroke[i - 1];
    const [bx, by] = stroke[i];
    const seg = Math.hypot(bx - ax, by - ay);
    if (left <= seg || i === stroke.length - 1) {
      const t = seg > 1e-6 ? Math.min(1, left / seg) : 1;
      return [ax + (bx - ax) * t, ay + (by - ay) * t];
    }
    left -= seg;
  }
  return stroke[stroke.length - 1];
}
