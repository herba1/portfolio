const G = {
  a: ["42 42 30 50 10 42 2 20 10 2 28 5 42 25", "42 50 42 12 48 0"],
  b: ["5 100 5 0", "5 30 20 48 38 45 45 25 36 4 18 2 5 10"],
  c: ["40 42 25 50 8 42 2 22 10 4 26 0 42 8"],
  d: ["40 30 28 48 10 42 2 20 10 2 28 5 42 25", "42 100 42 10 48 0"],
  e: ["5 24 40 28 36 46 20 50 5 38 2 18 12 3 28 0 42 8"],
  f: ["38 95 26 100 14 90 12 60 12 0", "0 48 32 50"],
  g: [
    "40 42 28 50 10 42 4 25 12 10 30 12 42 30",
    "42 50 42 -20 30 -38 12 -36 2 -25",
  ],
  h: ["5 100 5 0", "5 30 18 47 32 48 40 35 40 0"],
  i: ["8 48 8 2 14 0", "8 70 9 72"],
  j: ["18 48 18 -25 8 -38 0 -33", "18 70 19 72"],
  k: ["5 100 5 0", "38 50 6 20", "16 30 40 0"],
  l: ["6 100 6 6 14 0"],
  m: [
    "4 48 4 0",
    "4 32 14 48 26 46 30 30 30 0",
    "30 32 40 48 52 46 56 30 56 0",
  ],
  n: ["4 48 4 0", "4 30 16 47 32 48 40 35 40 0"],
  o: ["22 50 6 42 2 22 12 3 26 0 40 10 44 30 36 46 22 50 14 47"],
  p: ["5 50 5 -40", "5 30 18 48 36 46 44 26 36 5 18 2 5 12"],
  q: ["40 42 28 50 10 42 3 22 12 4 30 6 42 25", "42 50 42 -40 50 -32"],
  r: ["4 48 4 0", "4 28 14 45 30 50"],
  s: ["36 44 22 50 8 44 8 32 20 26 34 20 38 8 24 0 4 5"],
  t: ["14 78 14 8 20 0 32 3", "0 48 30 50"],
  u: ["4 48 4 15 12 2 26 2 38 15", "40 48 40 4 46 0"],
  v: ["0 48 20 0 40 50"],
  w: ["0 48 14 0 28 36 42 0 56 50"],
  x: ["2 48 38 0", "38 48 2 0"],
  y: ["2 48 20 4", "40 48 18 -20 8 -38 0 -36"],
  z: ["2 48 38 48 2 0 40 2"],
  0: ["22 80 6 66 2 38 8 8 22 0 36 10 42 40 37 68 22 80"],
  1: ["6 62 20 80 20 0"],
  2: ["4 62 14 76 28 80 40 68 38 50 20 25 2 2 42 2"],
  3: ["4 72 20 80 36 72 36 54 18 44 38 36 42 16 30 2 14 0 2 8"],
  4: ["30 0 30 80 2 24 44 24"],
  5: ["38 80 8 80 5 46 20 50 36 42 42 22 32 4 16 0 2 8"],
  6: ["36 76 22 80 8 66 2 36 6 10 20 0 36 6 42 24 32 42 16 42 4 30"],
  7: ["2 80 42 80 18 0"],
  8: [
    "22 44 6 56 8 74 22 80 36 74 38 56 22 44 4 30 4 10 22 0 40 10 40 30 22 44",
  ],
  9: ["38 56 26 42 10 44 2 60 10 76 26 80 38 70 40 50 34 20 20 0 6 4"],
  $: ["36 70 22 78 6 70 6 52 22 44 38 34 38 12 22 4 2 12", "22 90 21 -8"],
  ".": ["5 2 7 3"],
  "-": ["4 30 30 32"],
  "!": ["8 80 8 22", "8 3 9 4"],
  "'": ["8 82 6 62"],
  "/": ["0 0 30 80"],
  "&": ["44 0 10 50 8 70 18 80 30 72 28 58 4 30 4 10 18 0 34 6 44 26"],
};

const PARSED = Object.fromEntries(
  Object.entries(G).map(([k, strokes]) => {
    const list = strokes.map((s) => {
      const n = s.split(" ").map(Number);
      const pts = [];
      for (let i = 0; i < n.length; i += 2)
        pts.push([n[i] / 100, n[i + 1] / 100]);
      return pts;
    });
    let w = 0;
    for (const pts of list) for (const [x] of pts) w = Math.max(w, x);
    return [k, { list, w }];
  }),
);

function rand(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function spline(pts, steps) {
  if (pts.length < 3) return pts;
  const out = [];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(pts.length - 1, i + 2)];
    for (let s = 0; s < steps; s += 1) {
      const t = s / steps;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a, b, c, d) =>
        0.5 *
        (2 * b +
          (-a + c) * t +
          (2 * a - 5 * b + 4 * c - d) * t2 +
          (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(pts[pts.length - 1]);
  return out;
}

export function measureHand(text, size) {
  let x = 0;
  for (const ch of text.toLowerCase()) {
    const g = PARSED[ch];
    x += g ? (g.w + 0.14) * size : 0.32 * size;
  }
  return x;
}

export function writeHand(
  ctx,
  text,
  {
    x,
    y,
    size,
    color = "#1d1b2a",
    width = 0.07,
    slant = 0.16,
    seed = 7,
    angle = 0,
    pen = "marker",
  },
) {
  const r = rand(seed);
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = color;
  let cx = 0;
  let drift = 0;
  for (const ch of text.toLowerCase()) {
    const g = PARSED[ch];
    if (!g) {
      cx += 0.32 * size;
      continue;
    }
    drift += (r() - 0.5) * 0.05;
    const scale = size * (0.94 + r() * 0.12);
    const base = drift * size;
    const sl = slant + (r() - 0.5) * 0.08;
    for (const stroke of g.list) {
      const jittered = stroke.map(([px, py]) => [
        px + (r() - 0.5) * 0.035,
        py + (r() - 0.5) * 0.035,
      ]);
      const pts = spline(jittered, 8).map(([px, py]) => [
        cx + (px + py * sl) * scale,
        base - py * scale,
      ]);
      const passes = pen === "marker" ? 2 : 1;
      for (let p = 0; p < passes; p += 1) {
        ctx.globalAlpha = pen === "marker" ? (p === 0 ? 0.55 : 0.85) : 0.92;
        ctx.lineWidth = size * width * (p === 0 ? 1.12 : 0.9);
        ctx.beginPath();
        pts.forEach(([px, py], i) =>
          i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py),
        );
        ctx.stroke();
      }
      if (pen === "marker") {
        const [ex, ey] = pts[pts.length - 1];
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.arc(ex, ey, size * width * 0.62, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
      }
    }
    cx += (g.w + 0.14 + (r() - 0.5) * 0.04) * size;
  }
  ctx.restore();
  return cx;
}
