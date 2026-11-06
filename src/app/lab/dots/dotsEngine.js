import { createStage, clamp } from "../_kit/stage";

// After MuirMcNeil's TwoPoint: every letter is a two-dot stroke on one
// strict grid. Styles differ only in which dots are removed (alternate rows,
// columns, a chequerboard, diagonals), never in where a dot sits, so a
// pattern can sweep through the word while the word itself stays put.
//
// Glyphs are drawn as stroke skeletons (polylines with filleted corners) in
// grid units; a dot is part of a letter when its centre lies within one unit
// of the skeleton, which is exactly a two-dot stroke on straight runs.

const TITLE = ["DRIVE", "MY CAR"];
const CAP = 12; // rows
const GAP = 2; // columns between letters
const SPACE = 6;
const LEADING = 4; // rows between lines
const DOT = 0.44; // radius as a share of the pitch

// [width, strokes]; a stroke is a list of [x, y, filletRadius?] in units
// where a stem's skeleton sits at x = 1 (dots 0 and 1).
const GLYPHS = {
  D: [10, [[[1, 1], [9, 1, 4], [9, 11, 4], [1, 11], [1, 1]]]],
  R: [10, [[[1, 11], [1, 1], [9, 1, 3], [9, 6, 3], [1, 6]], [[5, 6], [9, 10, 0], [9, 11]]]],
  I: [2, [[[1, 1], [1, 11]]]],
  V: [10, [[[1, 1], [1, 6, 3], [5, 11, 1], [9, 6, 3], [9, 1]]]],
  E: [9, [[[8, 1], [1, 1], [1, 11], [8, 11]], [[1, 6], [7, 6]]]],
  M: [14, [[[1, 11], [1, 1, 3], [13, 1, 3], [13, 11]], [[7, 1], [7, 11]]]],
  Y: [10, [[[1, 1], [1, 6, 4], [9, 6, 4], [9, 1]], [[5, 6], [5, 11]]]],
  C: [10, [[[9, 1], [1, 1, 4], [1, 11, 4], [9, 11]]]],
  A: [10, [[[1, 11], [1, 1, 4], [9, 1, 4], [9, 11]], [[1, 7], [9, 7]]]],
};

// Polyline with filleted corners, sampled into segments.
function skeleton(points) {
  const out = [];
  for (let k = 0; k < points.length; k++) {
    const [px, py, r = 0] = points[k];
    if (k === 0 || k === points.length - 1 || !r) {
      out.push([px, py]);
      continue;
    }
    const [ax, ay] = points[k - 1];
    const [bx, by] = points[k + 1];
    let u1x = ax - px, u1y = ay - py, u2x = bx - px, u2y = by - py;
    const l1 = Math.hypot(u1x, u1y), l2 = Math.hypot(u2x, u2y);
    u1x /= l1; u1y /= l1; u2x /= l2; u2y /= l2;
    const theta = Math.acos(clamp(u1x * u2x + u1y * u2y, -1, 1));
    const t = r / Math.tan(theta / 2);
    let bisx = u1x + u2x, bisy = u1y + u2y;
    const bl = Math.hypot(bisx, bisy);
    bisx /= bl; bisy /= bl;
    const d = r / Math.sin(theta / 2);
    const cx = px + bisx * d, cy = py + bisy * d;
    const t1x = px + u1x * t, t1y = py + u1y * t;
    const t2x = px + u2x * t, t2y = py + u2y * t;
    let a0 = Math.atan2(t1y - cy, t1x - cx);
    let a1 = Math.atan2(t2y - cy, t2x - cx);
    let da = a1 - a0;
    while (da > Math.PI) da -= 2 * Math.PI;
    while (da < -Math.PI) da += 2 * Math.PI;
    for (let s = 0; s <= 24; s++) {
      const a = a0 + (da * s) / 24;
      out.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
    }
  }
  return out;
}

function segDist(x, y, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l = dx * dx + dy * dy;
  const t = l ? clamp(((x - ax) * dx + (y - ay) * dy) / l, 0, 1) : 0;
  return Math.hypot(x - ax - dx * t, y - ay - dy * t);
}

// Dot cells of the whole title, in grid units from the block's top left.
function layout() {
  const cells = [];
  let width = 0;
  TITLE.forEach((line, li) => {
    let x = 0;
    const top = li * (CAP + LEADING);
    for (const ch of line) {
      if (ch === " ") {
        x += SPACE;
        continue;
      }
      const [w, strokes] = GLYPHS[ch];
      const segs = strokes.map(skeleton);
      for (let j = 0; j < CAP; j++) {
        for (let i = 0; i < w; i++) {
          const cx = i + 0.5, cy = j + 0.5;
          let d = Infinity;
          for (const s of segs) for (let k = 1; k < s.length; k++) d = Math.min(d, segDist(cx, cy, s[k - 1][0], s[k - 1][1], s[k][0], s[k][1]));
          if (d < 0.8) cells.push([x + i, top + j]);
        }
      }
      x += w + GAP;
    }
    width = Math.max(width, x - GAP);
  });
  return { cells, cols: width, rows: TITLE.length * CAP + (TITLE.length - 1) * LEADING };
}

// The styles, in sweep order. Each keeps the stroke form and removes a set.
const PATTERNS = [
  () => true,
  (i, j) => j % 2 === 0, // alternate rows removed
  (i, j) => i % 2 === 0, // alternate columns removed
  (i, j) => (i + j) % 2 === 0, // chequerboard
  (i, j) => ((i - j) % 3 + 3) % 3 !== 2, // diagonals
];
const N = PATTERNS.length;
const mod = (a, n) => ((a % n) + n) % n;

export function createDots(host) {
  const stage = createStage(host, { dpr: 2 });
  const { ctx, canvas } = stage;
  canvas.style.cursor = "grab";

  const { cells, cols, rows } = layout();
  const count = cells.length;
  const scale = new Float32Array(count).fill(1);
  const vel = new Float32Array(count);
  const px = new Float32Array(count); // device-pixel centres
  const py = new Float32Array(count);
  const u = new Float32Array(count); // 0..1 across the word
  const masks = PATTERNS.map((p) => Uint8Array.from(cells, ([i, j]) => (p(i, j) ? 1 : 0)));

  let settled = false;
  let dirty = true;
  const paper = document.createElement("canvas");
  let pitch = 1, ox = 0, oy = 0, dpr = 2, W = 1, H = 1;

  const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
  const stillS = parseFloat(params.get("s"));
  const still = Number.isFinite(stillS);

  // s: integer = a held pattern; fractional = the front partway across.
  let s = still ? stillS : 0;
  let sVel = 0;
  let snapTo = null;
  let frontY = still ? parseFloat(params.get("y") ?? "0.5") : 0.5; // 0..1 of the block
  let lastX = 0;

  stage.onResize((w, h, d) => {
    W = w; H = h; dpr = d;
    // Full bleed: the longest line runs to one dot of the edges, unless the
    // stack is too tall for the box. Pitch is whole device pixels.
    const raw = Math.min(w / (cols + 2), h / (rows + 2));
    pitch = Math.max(1, Math.floor(raw * dpr)); // device px
    const bw = cols * pitch, bh = rows * pitch;
    ox = Math.round((w * dpr - bw) / 2);
    oy = Math.round((h * dpr - bh) / 2);
    for (let k = 0; k < count; k++) {
      px[k] = ox + (cells[k][0] + 0.5) * pitch;
      py[k] = oy + (cells[k][1] + 0.5) * pitch;
      u[k] = (cells[k][0] + 0.5) / cols;
    }
    paper.width = Math.round(w * d);
    paper.height = Math.round(h * d);
    const pc = paper.getContext("2d");
    pc.fillStyle = "#fff";
    pc.fillRect(0, 0, paper.width, paper.height);
    // The grid itself, edge to edge: pin dots at every position, as on the
    // specimen sheets' background patterns.
    pc.fillStyle = "#000";
    pc.beginPath();
    const rp = Math.max(1, pitch * 0.055);
    const gx0 = ox - Math.ceil(ox / pitch) * pitch + pitch / 2;
    const gy0 = oy - Math.ceil(oy / pitch) * pitch + pitch / 2;
    for (let y = gy0; y < paper.height + pitch; y += pitch) {
      for (let x = gx0; x < paper.width + pitch; x += pitch) {
        pc.moveTo(x + rp, y);
        pc.arc(x, y, rp, 0, Math.PI * 2);
      }
    }
    pc.fill();
    dirty = true;
    if (!settled) settle();
    settled = true;
  });

  // Where the front reaches each dot: across the word, bowed back away from
  // the pointer's row so it reads as a wave leaving the finger.
  const BOW = 0.18;
  const reach = (k) => {
    const dy = Math.abs((cells[k][1] + 0.5) / rows - frontY);
    return (u[k] * 0.86 + dy * BOW) / (0.86 + BOW + 1e-3) * 0.999 + 0.0005;
  };
  const patternAt = (k, sv) => mod(Math.floor(sv + 1 - reach(k)), N);

  const settle = () => {
  if (still) {
    // A held moment: dots near the front sit partway through their spring.
    const SOFT = 0.12;
    for (let k = 0; k < count; k++) {
      const base = Math.floor(s);
      const f = s - base - reach(k); // >0: front has passed this dot
      const a = masks[mod(base, N)][k], b = masks[mod(base + 1, N)][k];
      const t = clamp(f / SOFT, 0, 1);
      const e = t * t * (3 - 2 * t);
      scale[k] = a + (b - a) * e;
    }
  } else {
    for (let k = 0; k < count; k++) scale[k] = masks[patternAt(k, s)][k];
  }
  };

  stage.on("down", (p) => {
    lastX = p.x;
    snapTo = null;
    sVel = 0;
    canvas.style.cursor = "grabbing";
  });
  stage.on("move", (p) => {
    if (!p.down || still) return;
    dirty = true;
    const span = (cols * pitch) / dpr;
    s += (p.x - lastX) / span;
    lastX = p.x;
    frontY = clamp((p.y * dpr - oy) / (rows * pitch), 0, 1);
  });
  stage.on("up", (p) => {
    canvas.style.cursor = "grab";
    if (still) return;
    // Hold the pattern the front was nearest; a flick carries it on.
    const span = (cols * pitch) / dpr;
    const carry = clamp((p.vx / span) * 0.18, -0.6, 0.6);
    snapTo = Math.round(s + carry);
    dirty = true;
  });

  const K = 420; // dot spring
  const C = 2 * 0.8 * Math.sqrt(K);
  const R = DOT * 1.0;
  const TAU = Math.PI * 2;

  stage.onFrame((dt) => {
    if (!still && snapTo != null) {
      // The front glides home on its own spring.
      const ks = 60, cs = 2 * Math.sqrt(ks);
      sVel += (ks * (snapTo - s) - cs * sVel) * dt;
      s += sVel * dt;
      if (Math.abs(snapTo - s) < 1e-4 && Math.abs(sVel) < 1e-3) {
        s = snapTo;
        snapTo = null;
      }
    }
    let moving = snapTo != null;
    if (!still) {
      const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
      const h = dt / steps;
      for (let k = 0; k < count; k++) {
        const target = masks[patternAt(k, s)][k];
        let x = scale[k], v = vel[k];
        for (let n = 0; n < steps; n++) {
          v += (K * (target - x) - C * v) * h;
          x += v * h;
        }
        if (Math.abs(x - scale[k]) > 1e-5 || Math.abs(target - x) > 1e-3) moving = true;
        scale[k] = x;
        vel[k] = v;
      }
    }

    if (!dirty) return;
    dirty = moving;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(paper, 0, 0);
    ctx.fillStyle = "#000";
    ctx.beginPath();
    const r0 = R * pitch;
    const rMax = pitch * 0.485;
    for (let k = 0; k < count; k++) {
      const r = Math.min(rMax, scale[k] * r0);
      if (r < 0.15) continue;
      ctx.moveTo(px[k] + r, py[k]);
      ctx.arc(px[k], py[k], r, 0, TAU);
    }
    ctx.fill();
  });

  return { destroy: () => stage.destroy() };
}
