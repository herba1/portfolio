const GLYPHS = {
  a: [6, "A3 3 3 3 0 360", "M6 6 L6 0"],
  b: [6, "M0 10 L0 0", "A3 3 3 3 180 540"],
  c: [5.6, "A3 3 3 3 42 318"],
  d: [6, "A3 3 3 3 0 360", "M6 10 L6 0"],
  e: [6, "M0 3 L6 3 A3 3 3 3 0 318"],
  f: [4, "M1.4 0 L1.4 7.8 A3.4 7.8 2 2 180 50", "M0 6 L3.6 6"],
  g: [6, "A3 3 3 3 0 360", "M6 6 L6 -1.2 A3 -1.2 3 2.8 0 -160"],
  h: [6, "M0 10 L0 0", "M0 3 A3 3 3 3 180 0 L6 0"],
  i: [0.4, "M0.2 6 L0.2 0", "D0.2 8.4"],
  j: [2, "M1.6 6 L1.6 -2.4 A0.2 -2.4 1.4 1.6 0 -160", "D1.6 8.4"],
  k: [4.8, "M0 10 L0 0", "M4.6 6 L0 2.4", "M1.6 3.6 L4.8 0"],
  l: [0.4, "M0.2 10 L0.2 0"],
  m: [8.4, "M0 6 L0 0", "M0 4 A2.1 4 2.1 2 180 0 L4.2 0", "M4.2 4 A6.3 4 2.1 2 180 0 L8.4 0"],
  n: [6, "M0 6 L0 0", "M0 3 A3 3 3 3 180 0 L6 0"],
  o: [6, "A3 3 3 3 0 360"],
  p: [6, "M0 6 L0 -4", "A3 3 3 3 180 540"],
  q: [6, "A3 3 3 3 0 360", "M6 6 L6 -4"],
  r: [4, "M0 6 L0 0", "M0 3.4 A2.6 3.4 2.6 2.6 180 55"],
  s: [5, "A2.5 4.5 2.5 1.5 15 270 A2.5 1.5 2.5 1.5 90 -165"],
  t: [3.6, "M1.4 9 L1.4 0", "M0 6 L3.6 6"],
  u: [6, "M0 6 L0 3 A3 3 3 3 180 360", "M6 6 L6 0"],
  v: [5.6, "M0 6 L2.8 0 L5.6 6"],
  w: [8.4, "M0 6 L2.1 0 L4.2 6 L6.3 0 L8.4 6"],
  x: [5.2, "M0 6 L5.2 0", "M5.2 6 L0 0"],
  y: [5.6, "M0 6 L2.8 0", "M5.6 6 L1.6 -4"],
  z: [5.2, "M0 6 L5.2 6 L0 0 L5.2 0"],
  0: [6, "A3 4.5 3 4.5 0 360"],
  1: [3, "M0 7.2 L3 9 L3 0"],
  2: [6, "A3 6.4 2.9 2.6 165 -35 L0 0 L6 0"],
  3: [6, "A3 6.9 2.6 2.1 160 -90 A3 2.4 3 2.4 90 -160"],
  4: [6, "M4.6 0 L4.6 9 L0 2.6 L6 2.6"],
  5: [6, "M5.6 9 L1 9 L0.6 5.2 A3 3 3 3 135 -160"],
  6: [6, "M4.8 9 L0.8 4.6", "A3 3 3 3 0 360"],
  7: [6, "M0 9 L6 9 L2 0"],
  8: [6, "A3 6.8 2.4 2.2 0 360", "A3 2.4 3 2.4 90 450"],
  9: [6, "A3 6 3 3 0 360", "M6 6 L1.4 0"],
  "!": [0.4, "M0.2 10 L0.2 2.8", "D0.2 0.2"],
  "?": [5, "A2.5 7.4 2.5 2.5 160 -70 L2.4 2.8", "D2.4 0.2"],
  ".": [0.4, "D0.2 0.2"],
  ",": [1, "M1 0.8 L0 -1.6"],
  "'": [0.4, "M0.2 10 L0.2 7.4"],
  "-": [3.6, "M0 3 L3.6 3"],
  "&": [6.4, "M6.4 0 L1.4 6.2 A2.6 7.6 1.6 1.6 200 -20 L0.8 3 A3 2.2 2.4 2.2 160 300 L6 4"],
  "+": [5, "M2.5 5.5 L2.5 0.5", "M0 3 L5 3"],
  ":": [0.4, "D0.2 5.4", "D0.2 0.2"],
};

const SPACE = 3.8;
const TRACK = 2.4;

function arcPoints(cx, cy, rx, ry, a0, a1) {
  const span = a1 - a0;
  const steps = Math.max(6, Math.ceil((Math.abs(span) / 360) * 44 * Math.sqrt(Math.max(rx, ry) / 3)));
  const out = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = ((a0 + (span * i) / steps) * Math.PI) / 180;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}

function parseStroke(src) {
  const tokens = src.trim().split(/\s+/);
  const pts = [];
  let dot = false;
  let i = 0;
  while (i < tokens.length) {
    const t = tokens[i];
    const op = t[0];
    const first = Number(t.slice(1));
    if (op === "M" || op === "L") {
      pts.push([first, Number(tokens[i + 1])]);
      i += 2;
    } else if (op === "D") {
      pts.push([first, Number(tokens[i + 1])]);
      dot = true;
      i += 2;
    } else if (op === "A") {
      const [cy, rx, ry, a0, a1] = tokens.slice(i + 1, i + 6).map(Number);
      const arc = arcPoints(first, cy, rx, ry, a0, a1);
      if (pts.length) arc.shift();
      pts.push(...arc);
      i += 6;
    } else {
      i += 1;
    }
  }
  return { pts, dot };
}

const CACHE = new Map();

function glyph(ch) {
  if (CACHE.has(ch)) return CACHE.get(ch);
  const def = GLYPHS[ch];
  const g = def ? { w: def[0], strokes: def.slice(1).map(parseStroke) } : null;
  CACHE.set(ch, g);
  return g;
}

export function canDraw(ch) {
  return ch === " " || Boolean(GLYPHS[ch]);
}

export function textStrokes(text) {
  const chars = [...text.toLowerCase()];
  const strokes = [];
  let x = 0;
  chars.forEach((ch, idx) => {
    if (ch === " ") {
      x += SPACE;
      return;
    }
    const g = glyph(ch);
    if (!g) return;
    for (const s of g.strokes) strokes.push({ pts: s.pts.map(([px, py]) => [px + x, py]), dot: s.dot, speed: 1 });
    x += g.w + (idx < chars.length - 1 ? TRACK : 0);
  });
  if (!strokes.length) return [];
  const width = Math.max(x, 1);
  const mid = 3;
  const scale = Math.min(2.2 / width, 0.118);
  return strokes.map((s) => ({ ...s, pts: s.pts.map(([px, py]) => [(px - width / 2) * scale, (py - mid) * scale]) }));
}

function circle(r, cx = 0, cy = 0, steps = 96, start = 90) {
  const out = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = ((start + (360 * i) / steps) * Math.PI) / 180;
    out.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return out;
}

function record() {
  return [
    { pts: circle(0.86, 0, 0, 128), speed: 1 },
    { pts: circle(0.72, 0, 0, 112), speed: 2.6 },
    { pts: circle(0.58, 0, 0, 96), speed: 2.6 },
    { pts: circle(0.34, 0, 0, 72), speed: 1 },
    { pts: [[0, 0]], dot: true, speed: 1 },
  ];
}

function sun() {
  const strokes = [{ pts: circle(0.34, 0, 0, 80), speed: 1 }];
  for (let i = 0; i < 12; i += 1) {
    const a = (i / 12) * Math.PI * 2 + Math.PI / 2;
    const r0 = 0.48;
    const r1 = i % 2 ? 0.7 : 0.84;
    strokes.push({ pts: [[Math.cos(a) * r0, Math.sin(a) * r0], [Math.cos(a) * r1, Math.sin(a) * r1]], speed: 1 });
  }
  return strokes;
}

function apple() {
  const body = [];
  const steps = 140;
  for (let i = 0; i <= steps; i += 1) {
    const phi = Math.PI / 2 + (i / steps) * Math.PI * 2;
    const top = Math.exp(-(((phi - Math.PI / 2) % (Math.PI * 2)) ** 2) / 0.09) + Math.exp(-((phi - Math.PI / 2 - Math.PI * 2) ** 2) / 0.09);
    const bot = Math.exp(-((phi - Math.PI * 1.5) ** 2) / 0.07);
    const r = 0.66 * (1 + 0.05 * Math.cos(2 * phi)) - 0.16 * top - 0.06 * bot;
    body.push([Math.cos(phi) * r * 1.08, Math.sin(phi) * r - 0.06]);
  }
  const stem = [];
  for (let i = 0; i <= 10; i += 1) {
    const t = i / 10;
    stem.push([0.0 + 0.06 * t * t, 0.46 + 0.36 * t]);
  }
  const leaf = [];
  for (let i = 0; i <= 18; i += 1) {
    const t = i / 18;
    leaf.push([0.04 + 0.36 * t, 0.66 + 0.2 * t + 0.1 * Math.sin(t * Math.PI)]);
  }
  for (let i = 0; i <= 18; i += 1) {
    const t = 1 - i / 18;
    leaf.push([0.04 + 0.36 * t, 0.66 + 0.2 * t - 0.08 * Math.sin(t * Math.PI)]);
  }
  return [
    { pts: body, speed: 1 },
    { pts: stem, speed: 1 },
    { pts: leaf, speed: 1 },
  ];
}

function heart() {
  const pts = [];
  const steps = 140;
  for (let i = 0; i <= steps; i += 1) {
    const t = (i / steps) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    pts.push([x * 0.046, y * 0.046 + 0.06]);
  }
  return [{ pts, speed: 1 }];
}

function lissajous() {
  const pts = [];
  const steps = 260;
  for (let i = 0; i <= steps; i += 1) {
    const t = (i / steps) * Math.PI * 2;
    pts.push([Math.sin(3 * t + Math.PI / 4) * 0.92, Math.sin(2 * t) * 0.8]);
  }
  return [{ pts, speed: 1 }];
}

export const SHAPES = { record, sun, apple, heart, lissajous };

export function buildTable(strokes, n) {
  const table = new Float32Array(n * 2);
  if (!strokes.length) return { table, length: 0 };
  const drawSpeed = 1;
  const jumpSpeed = 45;
  const dwell = 0.03;
  const knots = [];
  let t = 0;
  let length = 0;
  const push = (p) => knots.push({ p, t });
  let prev = null;
  strokes.forEach((s) => {
    const first = s.pts[0];
    if (prev) {
      const d = Math.hypot(first[0] - prev[0], first[1] - prev[1]);
      t += d / jumpSpeed + 0.002;
    }
    push(first);
    if (s.dot) {
      t += dwell;
      push(first);
    }
    for (let i = 1; i < s.pts.length; i += 1) {
      const a = s.pts[i - 1];
      const b = s.pts[i];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]);
      length += d;
      t += d / (drawSpeed * (s.speed || 1));
      push(b);
    }
    prev = s.pts[s.pts.length - 1];
  });
  const start = strokes[0].pts[0];
  t += Math.hypot(start[0] - prev[0], start[1] - prev[1]) / jumpSpeed + 0.002;
  push(start);
  const total = t;
  let k = 0;
  for (let i = 0; i < n; i += 1) {
    const at = (i / n) * total;
    while (k < knots.length - 2 && knots[k + 1].t <= at) k += 1;
    const a = knots[k];
    const b = knots[k + 1];
    const span = b.t - a.t;
    const f = span > 1e-9 ? (at - a.t) / span : 0;
    table[i * 2] = a.p[0] + (b.p[0] - a.p[0]) * f;
    table[i * 2 + 1] = a.p[1] + (b.p[1] - a.p[1]) * f;
  }
  return { table, length };
}
