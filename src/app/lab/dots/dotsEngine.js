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
const GAP = 1 * MOD; // columns between letters
const SPACE = 3 * MOD;
const LEADING = 2 * MOD; // rows between lines
const DOT = 0.44; // radius as a share of the pitch

// One character per module, nine modules tall. # a module; / a module
// shifted one dot right (rising stairs); + its left column only, - its
// right column only (where a shifted stair meets a bar or junction).
const CELL = { "#": [0, 1], "/": [1, 2], "+": [0], "-": [1] };
const GLYPHS = {
  D: ["####...", "#...#..", "#....#.", "#.....#", "#.....#", "#.....#", "#..../.", "#.../..", "####+.."],
  R: ["#####..", "#....#.", "#.....#", "#..../.", "#####+.", "#..#...", "#...#..", "#....#.", "#.....#"],
  I: ["#", "#", "#", "#", "#", "#", "#", "#", "#"],
  V: ["#.....#", "#.....#", "#.....#", "#.....#", "#.....#", "#.....#", ".#.../.", "..#./..", "...#+.."],
  E: ["######", "#.....", "#.....", "#.....", "#####.", "#.....", "#.....", "#.....", "######"],
  M: ["#.......#", "##...../#", "#.#.../.#", "#..#./..#", "#...#+..#", "#.......#", "#.......#", "#.......#", "#.......#"],
  Y: ["#.....#", "#.....#", ".#.../.", "..#./..", "...#+..", "...#...", "...#...", "...#...", "...#..."],
  C: ["..-####", "./.....", "/......", "#......", "#......", "#......", ".#.....", "..#....", "...####"],
  A: ["..-#+..", "./..#..", "/....#.", "#.....#", "#.....#", "#######", "#.....#", "#.....#", "#.....#"],
};

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

// Dot cells of the whole title, in grid units from the block's top left.
// Every glyph starts on an even column and every line on an even row, so the
// removal patterns meet each stroke in the same phase.
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
      const rows = GLYPHS[ch];
      for (const [i, j] of glyphCells(rows)) cells.push([x + i, top + j]);
      x += rows[0].length * MOD + GAP;
    }
    width = Math.max(width, x - GAP);
  });
  return { cells, cols: width, rows: TITLE.length * CAP + (TITLE.length - 1) * LEADING };
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
