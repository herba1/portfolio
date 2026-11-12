import { createStage, clamp } from "../_kit/stage";

// After MuirMcNeil's TwoPoint: every letter is a two-dot stroke on one
// strict grid. Styles differ only in which dots are removed (alternate rows,
// columns, a chequerboard, diagonals), never in where a dot sits, so a
// pattern can sweep through the word while the word itself stays put.
//
// The letters are drawn on the grid itself, not rasterised from outlines.
// Each glyph is a bitmap of 2x2 dot modules: a stem is one module wide on an
// even column, a bar one module tall on an even row, and every curve or
// diagonal is a 45-degree stair of modules touching corner to corner. So a
// stroke is exactly two dots across wherever you cut it, and taking away
// every other row, every other column or every other diagonal always leaves
// one continuous dot per cross-section: each style is still a typeface.
//
// One refinement keeps the chequerboard honest. A stair rising to the right
// ("/") is drawn one dot to the right of the module grid, so both stair
// directions keep a continuous line of single dots when alternate diagonals
// go, instead of one direction breaking into ticks.

const TITLE = ["DRIVE", "MY CAR"];
const MOD = 2; // dots per module
const CAP = 9 * MOD; // rows
const DOT = 0.44; // radius as a share of the pitch

// One character per module, nine modules tall. # a module; / a module
// shifted one dot right (rising stairs); + its left column only, - its
// right column only (where a shifted stair meets a bar or junction).
//
// V, M and Y are drawn with true 45-degree diagonals, one module across per
// module down, straight from cap height: V's arms meet on the baseline, M's
// vee reaches two thirds of the way down, Y's arms meet at mid-height and
// centre. That makes V wide, as a real 45-degree V is.
const CELL = { "#": [0, 1], "/": [1, 2], "+": [0], "-": [1] };
const GLYPHS = {
  D: ["####...", "#...#..", "#....#.", "#.....#", "#.....#", "#.....#", "#..../.", "#.../..", "####+.."],
  R: ["#####..", "#....#.", "#.....#", "#..../.", "#####+.", "#..#...", "#...#..", "#....#.", "#.....#"],
  I: ["#", "#", "#", "#", "#", "#", "#", "#", "#"],
  V: [
    "#.............../",
    ".#............./.",
    "..#.........../..",
    "...#........./...",
    "....#......./....",
    ".....#...../.....",
    "......#.../......",
    ".......#./.......",
    "........#+.......",
  ],
  E: ["#######", "#......", "#......", "#......", "######.", "#......", "#......", "#......", "#######"],
  M: [
    "#.........#",
    "##......./#",
    "#.#...../.#",
    "#..#.../..#",
    "#...#./...#",
    "#....#+...#",
    "#.........#",
    "#.........#",
    "#.........#",
  ],
  Y: ["#......./", ".#...../.", "..#.../..", "...#./...", "....#+...", "....#....", "....#....", "....#....", "....#...."],
  C: ["..-####", "./.....", "/......", "#......", "#......", "#......", ".#.....", "..#....", "...####"],
  A: ["..-#+..", "./..#..", "/....#.", "#.....#", "#.....#", "#######", "#.....#", "#.....#", "#.....#"],
};

// Side bearings. Each side of a glyph is a straight stem (s) or a round,
// diagonal or open side (o). Two stems face each other at two modules; any
// round or diagonal side sits one module from its neighbour. Distances are
// measured ink to ink, then pushed to the next even column so every glyph
// keeps its module phase.
const SIDES = { D: "so", R: "ss", I: "ss", V: "oo", E: "so", M: "ss", Y: "oo", C: "oo", A: "ss" };
const fit = (a, b) => (SIDES[a][1] === "s" && SIDES[b][0] === "s" ? 2 * MOD : MOD);
const SPACE = 3; // dots, ink to ink, before rounding to an even column

// Dot cells of one glyph, in grid units from its top left.
function glyphCells(rows) {
  const seen = new Set();
  const out = [];
  rows.forEach((row, my) => {
    [...row].forEach((ch, mx) => {
      for (const o of CELL[ch] || []) {
        for (let dy = 0; dy < MOD; dy++) {
          const i = mx * MOD + o, j = my * MOD + dy;
          const key = i * 64 + j;
          if (seen.has(key)) continue;
          seen.add(key);
          out.push([i, j]);
        }
      }
    });
  });
  return out;
}

const even = (v) => Math.ceil(v / 2) * 2;

// One line at its natural fit: glyph origins and the gaps between them.
function setLine(line) {
  const items = [];
  let right = 0; // ink edge of the last glyph
  let prev = null;
  let space = false;
  for (const ch of line) {
    if (ch === " ") {
      space = true;
      continue;
    }
    const cells = glyphCells(GLYPHS[ch]);
    const ink = Math.max(...cells.map((c) => c[0])) + 1;
    const x = prev ? even(right + (space ? SPACE : fit(prev, ch))) : 0;
    items.push({ ch, cells, x, ink, word: space });
    right = x + ink;
    prev = ch;
    space = false;
  }
  return { items, width: right };
}

// The title set to one measure. The longest line sets it; every shorter line
// is tracked out, in whole module columns spread evenly over its letter gaps
// (never its word spaces), until both lines share a left and a right edge.
// Cells carry their line, so the leading can be chosen later, at resize.
function layout() {
  const lines = TITLE.map(setLine);
  const measure = Math.max(...lines.map((l) => l.width));
  const cells = [];
  lines.forEach((l, li) => {
    // Letter gaps, the ones set beside a round or diagonal side first, so two
    // facing stems stay at their two modules as long as possible.
    const gaps = l.items
      .map((it, n) => (n > 0 && !it.word ? n : -1))
      .filter((n) => n > 0)
      .sort((a, b) => fit(l.items[a - 1].ch, l.items[a].ch) - fit(l.items[b - 1].ch, l.items[b].ch) || a - b);
    const units = Math.floor((measure - l.width) / 2);
    const add = new Array(l.items.length).fill(0);
    for (let u = 0; u < units; u++) add[gaps[u % gaps.length]] += 2;
    let shift = 0;
    l.items.forEach((it, n) => {
      shift += add[n];
      for (const [i, j] of it.cells) cells.push([it.x + shift + i, j, li]);
    });
  });
  return { cells, cols: measure };
}

const mod = (a, n) => ((a % n) + n) % n;

// The styles, in sweep order. Each keeps the stroke form and removes a set.
const PATTERNS = [
  () => true,
  (i, j) => j % 2 === 0, // alternate rows removed
  (i, j) => i % 2 === 0, // alternate columns removed
  (i, j) => (i + j) % 2 === 0, // chequerboard
  (i, j) => mod(i - j, 4) !== 3, // every fourth diagonal: at most one dot per module
];
const N = PATTERNS.length;

export function createDots(host) {
  const stage = createStage(host, { dpr: 2 });
  const { ctx, canvas } = stage;
  canvas.style.cursor = "grab";

  const { cells, cols } = layout();
  const LINES = TITLE.length;
  const count = cells.length;
  const scale = new Float32Array(count).fill(1);
  const vel = new Float32Array(count);
  const px = new Float32Array(count); // device-pixel centres
  const py = new Float32Array(count);
  const u = new Float32Array(count); // 0..1 across the word
  const gj = new Int16Array(count); // row on the shared grid
  let masks = [];
  let rows = CAP;
  let leading = -1;

  let settled = false;
  let dirty = true;
  let pitch = 1, ox = 0, oy = 0, dpr = 2;

  const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
  const stillS = parseFloat(params.get("s"));
  const still = Number.isFinite(stillS);

  // s: integer = a held pattern; fractional = the front partway across.
  let s = still ? stillS : 0;
  let sVel = 0;
  let snapTo = null;
  let frontY = still ? parseFloat(params.get("y") ?? "0.5") : 0.5; // 0..1 of the block
  let lastX = 0;

  // The measure runs the full width of the box, one module in from each
  // edge; pitch is whole device pixels. The leading then opens, in steps of
  // two modules so the removal patterns keep their phase on every line,
  // until the margins above and below match the side margins, up to a
  // cap-height's blank between lines. A short, wide box fits the height.
  const MARGIN = MOD;
  const LEAD_MIN = 2 * MOD, LEAD_MAX = 10 * MOD, LEAD_STEP = 2 * MOD;
  stage.onResize((w, h, d) => {
    dpr = d;
    const dw = w * d, dh = h * d;
    const byW = dw / (cols + 2 * MARGIN);
    const byH = dh / (LINES * CAP + (LINES - 1) * LEAD_MIN + 2 * MARGIN);
    pitch = Math.max(1, Math.floor(Math.min(byW, byH)));
    const side = (dw - cols * pitch) / 2 / pitch; // side margin in dots
    const spare = dh / pitch - LINES * CAP - 2 * side;
    const lead = LINES > 1
      ? clamp(Math.floor(spare / (LINES - 1) / LEAD_STEP) * LEAD_STEP, LEAD_MIN, LEAD_MAX)
      : 0;
    if (lead !== leading) {
      leading = lead;
      rows = LINES * CAP + (LINES - 1) * leading;
      for (let k = 0; k < count; k++) gj[k] = cells[k][1] + cells[k][2] * (CAP + leading);
      masks = PATTERNS.map((p) => Uint8Array.from(cells, (c, k) => (p(c[0], gj[k]) ? 1 : 0)));
    }
    ox = Math.round((dw - cols * pitch) / 2);
    oy = Math.round((dh - rows * pitch) / 2);
    for (let k = 0; k < count; k++) {
      px[k] = ox + (cells[k][0] + 0.5) * pitch;
      py[k] = oy + (gj[k] + 0.5) * pitch;
      u[k] = (cells[k][0] + 0.5) / cols;
    }
    dirty = true;
    if (still || !settled) settle();
    settled = true;
  });

  // Where the front reaches each dot: across the word, bowed back away from
  // the pointer's row so it reads as a wave leaving the finger.
  const BOW = 0.18;
  const reach = (k) => {
    const dy = Math.abs((gj[k] + 0.5) / rows - frontY);
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
    // Black dots on a flat white field, nothing else.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
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
