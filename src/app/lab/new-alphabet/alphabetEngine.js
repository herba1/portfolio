import { createStage, clamp, damp } from "../_kit/stage";

// An original raster alphabet on the principle of Crouwel's New Alphabet:
// strokes are only horizontal or vertical, corners are cut at 45 degrees,
// and every vertex sits on a dot of the screen's raster. The raster is the
// variable here. A glyph is written once, in relative terms, and resolved
// for whatever raster it is given: a cap height of n rows, a width of w
// columns, a corner cut of c cells, all whole numbers so nothing ever falls
// between the dots.
//
// Glyph syntax: points are X then Y. X is L (0), C (w/2) or R (w); Y is
// T (0), M (n/2, rounded down) or B (n); either can carry a whole-cell
// offset (C-1, M+1). A point marked * gets the house corner cut; one marked
// # is cut as far as its two strokes allow, which is how diagonals are made.
// Strokes are separated by |, and a stroke ending in z is closed.
//
// After the strokes come the left and right sidebearings, as a share of the
// house bearing: 1 beside a straight full-height stem (H, E's left, N, M),
// a little less beside a cut corner, and much less where the side is open
// and the letter's own counter already brings white into the word: T on
// both sides, the arms of L, F, P, K, the diagonals of V, X, Y, the stem of
// J and the flag of 1 on the left, the narrow I. They are spacing, so they
// are set by eye, by side, and never by width.
const GLYPHS = {
  A: [0.62, "LB LT* RT* RB | LM RM", 0.95, 0.95],
  B: [0.62, "LB LT RT* RM* LM | LM RM* RB* LB", 1, 0.9],
  C: [0.58, "RT LT* LB* RB", 0.9, 0.45],
  D: [0.64, "LB LT RT* RB* z", 1, 0.9],
  E: [0.56, "RT LT LB RB | LM RM", 1, 0.7],
  F: [0.56, "RT LT LB | LM RM", 1, 0.3],
  G: [0.62, "RT LT* LB* RB* RM CM", 0.9, 0.9],
  H: [0.62, "LT LB | RT RB | LM RM", 1, 1],
  I: [0, "CT CB", 0.8, 0.8],
  J: [0.5, "RT RB* LB* L,M+1", 0.35, 1],
  K: [0.6, "LT LB | LM RM# RT | LM RM# RB", 1, 0.45],
  L: [0.52, "LT LB RB", 1, 0.25],
  M: [0.86, "LB LT* RT* RB | CT CB", 1, 1],
  N: [0.62, "LB LT* RT* RB", 1, 1],
  O: [0.66, "LT* RT* RB* LB* z", 0.9, 0.9],
  P: [0.6, "LB LT RT* RM* LM", 1, 0.5],
  Q: [0.66, "RB LB* LT* RT* RB | RB R+1,B", 0.9, 0.7],
  R: [0.6, "LB LT RT* RM* LM | CM RM# RB", 1, 0.85],
  S: [0.6, "RT LT* LM* RM* RB* LB", 0.8, 0.8],
  T: [0.62, "LT RT | CT CB", 0.2, 0.2],
  U: [0.62, "LT LB* RB* RT", 1, 1],
  V: [0.62, "LT LB# RB# RT", 0.45, 0.45],
  W: [0.86, "LT LB* RB* RT | CB CM", 1, 1],
  X: [0.62, "LT LM# RM# RT | LB LM# RM# RB", 0.45, 0.45],
  Y: [0.62, "LT LM# RM# RT | CM CB", 0.3, 0.3],
  Z: [0.6, "LT RT RM# LM# LB RB", 0.6, 0.6],
  0: [0.54, "LT* RT* RB* LB* z | CM-1 CM+1", 0.9, 0.9],
  1: [0.4, "LT CT# CB", 0.4, 0.8],
  2: [0.58, "LT RT* RM* LM* LB RB", 0.75, 0.75],
  3: [0.58, "LT RT* RB* LB | CM RM", 0.5, 0.85],
  4: [0.6, "LT LM* RM | RT RB", 0.6, 1],
  5: [0.58, "RT LT LM RM* RB* LB", 0.9, 0.75],
  6: [0.58, "RT LT* LB* RB* RM* LM", 0.9, 0.8],
  7: [0.56, "LT RT* RB", 0.45, 1],
  8: [0.6, "LT* RT* RB* LB* z | LM RM", 0.9, 0.9],
  9: [0.58, "LB RB* RT* LT* LM* RM", 0.8, 0.9],
};

const parsed = {};
for (const [ch, [ratio, src, lsb, rsb]] of Object.entries(GLYPHS)) {
  parsed[ch] = {
    ratio,
    lsb,
    rsb,
    strokes: src.split("|").map((s) => {
      const toks = s.trim().split(/\s+/);
      const closed = toks[toks.length - 1] === "z";
      if (closed) toks.pop();
      const pts = toks.map((t) => {
        const m = /^([LCR])([+-]\d+)?([TMB])([+-]\d+)?([*#])?$/.exec(t.replace(",", ""));
        if (!m) throw new Error(`bad glyph point ${ch}:${t}`);
        return { x: m[1], dx: +(m[2] || 0), y: m[3], dy: +(m[4] || 0), cut: m[5] || "" };
      });
      return { pts, closed };
    }),
  };
}

const glyphWidth = (g, n) => (g.ratio === 0 ? 0 : Math.max(2, Math.round(n * g.ratio)));

// Resolve one glyph on a raster: a list of strokes, each a flat list of
// whole-cell points. The number of points per stroke depends only on the
// glyph, never on the raster, so a stroke can always spring from one
// resolution to the next point for point.
function resolve(g, n, c) {
  const w = glyphWidth(g, n);
  const X = { L: 0, C: Math.floor(w / 2), R: w };
  const Y = { T: 0, M: Math.floor(n / 2), B: n };
  return g.strokes.map(({ pts, closed }) => {
    const P = pts.map((p) => [X[p.x] + p.dx, Y[p.y] + p.dy]);
    const N = P.length;
    const corner = (i) => (closed || (i > 0 && i < N - 1)) && pts[i].cut;
    // How far a corner may cut into a segment: all of it, or half when the
    // far end is cut too.
    const avail = (i, j) => {
      const len = Math.abs(P[j][0] - P[i][0]) + Math.abs(P[j][1] - P[i][1]);
      return corner(j) ? len / 2 : len;
    };
    const out = [];
    for (let i = 0; i < N; i++) {
      if (!corner(i)) {
        out.push(P[i]);
        continue;
      }
      const a = (i - 1 + N) % N;
      const b = (i + 1) % N;
      const lim = Math.min(avail(i, a), avail(i, b));
      const k = Math.floor(pts[i].cut === "#" ? lim : Math.min(c, lim));
      const din = [Math.sign(P[i][0] - P[a][0]), Math.sign(P[i][1] - P[a][1])];
      const dout = [Math.sign(P[b][0] - P[i][0]), Math.sign(P[b][1] - P[i][1])];
      out.push([P[i][0] - din[0] * k, P[i][1] - din[1] * k], [P[i][0] + dout[0] * k, P[i][1] + dout[1] * k]);
    }
    return { pts: out, closed };
  });
}

const N_MIN = 4;
const N_MAX = 36;
const DEFAULT_WORD = "RASTER";
const cutFor = (n) => Math.max(1, Math.round(n * 0.14));
// The letters' stroke, as a share of a cell and bounded by the cap height
// so a fine raster still sets a word and a coarse one does not fill in.
const STROKE = 0.78;
const STROKE_MIN = 0.05;
const STROKE_MAX = 0.16;
const inkCells = (n) => clamp(STROKE, STROKE_MIN * n, STROKE_MAX * n);
// The house bearing in cells, measured from the edge of the ink: two full
// stems sit a fifth of the cap height apart, centre to centre.
const bearing = (n) => Math.max(0, (n * 0.2 - inkCells(n)) / 2);
// The space between two letters, centre line to centre line: the stroke,
// plus the right bearing of the first and the left bearing of the second,
// resolved to whole cells so every letter still starts on a column of dots
// and every vertex lands on one. At least half a cell of white is left, so
// two open sides never touch on a coarse raster.
const space = (a, b, n) => {
  const ink = inkCells(n);
  return Math.max(Math.ceil(ink + 0.5), Math.round(ink + (a.rsb + b.lsb) * bearing(n)));
};

// Set a word in cells: where each letter starts, and the run from the first
// ink to the last. The outer bearings are not counted, so the word centres
// on its ink.
function setWord(glyphs, n) {
  let x = 0;
  const at = glyphs.map((g, i) => {
    if (i > 0) x += glyphWidth(glyphs[i - 1], n) + space(glyphs[i - 1], g, n);
    return x;
  });
  const total = glyphs.length ? x + glyphWidth(glyphs[glyphs.length - 1], n) : 0;
  return { at, total };
}

// Lay out a word in cells from the raster's origin, which is the word's
// own corner: the first stem on x = 0 and the baseline on y = 0, so the cap
// line is always row -n. Those three never move with the raster; only the
// vertices between them do.
function layout(word, n) {
  const c = cutFor(n);
  const glyphs = [...word].map((ch) => parsed[ch]);
  const { at: starts, total } = setWord(glyphs, n);
  const letters = glyphs.map((g, i) => resolve(g, n, c).map((s) => ({ closed: s.closed, pts: s.pts.map(([px, py]) => [px + starts[i], py - n]) })));
  return { letters, total };
}

// Width of a word in cap heights, for fitting it to the box.
// The widest the word gets at any raster, since rounding to whole cells
// widens a coarse one.
function aspect(word) {
  const glyphs = [...word].map((ch) => parsed[ch]);
  let most = 1;
  for (let n = N_MIN; n <= N_MAX; n++) most = Math.max(most, setWord(glyphs, n).total / n);
  return most;
}

const params = () => {
  try {
    return new URLSearchParams(window.location.search);
  } catch {
    return new URLSearchParams();
  }
};

export async function createAlphabet(host, { embedded = false } = {}) {
  const stage = createStage(host, { dpr: 2 });
  const ctx = stage.ctx;
  const q = params();
  const stillN = q.has("pitch") ? clamp(Math.round(+q.get("pitch") || 12), N_MIN, N_MAX) : null;
  const clean = (s) => (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 9);

  let word = clean(q.get("word")) || DEFAULT_WORD;
  let capH = 200; // the word's cap height, in px, at a whole number of rows
  let pitch = 25; // px between dots
  let n = 8;
  let pitchV = 0; // log pitch per second, after a throw
  let drag = null;
  let frozen = false;
  let time = 0;

  // Live strokes: one per stroke of each glyph, keyed by slot and letter so
  // a retyped letter is a new set of strokes and an unchanged one moves.
  // Points and targets are in px from the word's origin, its first stem on
  // its baseline (cells x capH / n), so the word holds its cap height through
  // a change of raster and the springs carry only the snap from each old dot
  // to its new one. The baseline is pinned half a cap height below the
  // screen's centre, so cap line and baseline never move.
  let strokes = [];
  // The origin's distance left of the screen's centre: half the word's ink.
  // A new raster rounds the word a little wider or narrower, and the origin
  // glides there as one piece, dots and letters together, so that drift is
  // never sprung letter by letter.
  let orgX = 0;
  let orgT = 0;

  const fit = () => {
    const W = stage.width;
    const H = stage.height;
    const was = capH;
    capH = Math.min(H * 0.4, (W * 0.8) / aspect(word));
    // Live strokes are in px: rescale them with the word, so a refit is a
    // change of size and not something the springs have to animate.
    const k = capH / was;
    pitch *= k;
    orgX *= k;
    orgT *= k;
    for (const st of strokes) {
      for (const p of st.pts) Object.assign(p, { x: p.x * k, y: p.y * k, vx: p.vx * k, vy: p.vy * k });
      st.target = st.target.map(([x, y]) => [x * k, y * k]);
    }
  };

  const retarget = (spawn = false, immediate = false) => {
    const { letters: lay, total } = layout(word, n);
    const cell = capH / n;
    orgT = (-total * cell) / 2;
    if (immediate) orgX = orgT;
    const next = [];
    // The word reseats letter by letter, and a letter's strokes always move
    // together, so its joins stay registered all the way.
    const step = Math.min(0.045, 0.3 / Math.max(1, lay.length));
    const busy = (st) => st.born && st.due <= time && st.pts.some((p, i) => Math.abs(p.vx) + Math.abs(p.vy) > 4 || Math.abs(p.x - st.target[i][0]) + Math.abs(p.y - st.target[i][1]) > 0.5);
    const letters = lay.map((glyph, gi) =>
      glyph.map((s, si) => {
        const key = `${gi}:${word[gi]}:${si}`;
        const target = s.pts.map(([x, y]) => [x * cell, y * cell]);
        // A new stroke is set whole on its own dots when its turn comes,
        // never grown out of its first point.
        const st = strokes.find((o) => o.key === key) || { key, closed: s.closed, born: immediate, pts: target.map(([x, y]) => ({ x, y, vx: 0, vy: 0 })) };
        return [st, target];
      }),
    );
    // Which way each letter travels along the line to its new dots, against
    // the word's origin. The origin carries the word as a whole, so this is
    // only the change of spacing, and that is what can crowd a neighbour.
    const shift = letters.map((live) => {
      let d = 0;
      let k = 0;
      for (const [st, target] of live) {
        if (!st.born) continue;
        st.pts.forEach((p, i) => {
          d += target[i][0] - p.x;
          k++;
        });
      }
      return k ? d / k : 0;
    });
    // The order follows the spacing: a letter never moves into the white of
    // a neighbour that is still to go. The first stem holds, so as a word
    // opens out the far end leaves first and each letter follows the one it
    // would crowd; as it closes up, the letters next to the first go first.
    // A typed word is set left to right, as it is read.
    const rank = [];
    const rankOf = (i) => {
      if (rank[i] !== undefined) return rank[i];
      const j = shift[i] > 0.5 ? i + 1 : shift[i] < -0.5 ? i - 1 : -1;
      const ahead = j >= 0 && j < letters.length && Math.sign(shift[j]) === Math.sign(shift[i]) && Math.abs(shift[j]) > 0.5;
      return (rank[i] = ahead ? rankOf(j) + 1 : 0);
    };
    letters.forEach((live, gi) => {
      // A letter still on its way is not held back again, so a drag through
      // many rasters keeps it moving; one at rest waits its turn.
      const due = immediate || live.some(([st]) => busy(st)) ? time : time + (spawn ? gi * step + 0.04 : rankOf(gi) * step);
      for (const [st, target] of live) {
        st.target = target;
        st.due = due;
        next.push(st);
      }
    });
    strokes = next;
  };

  const setN = (m, opts) => {
    m = clamp(m, N_MIN, N_MAX);
    if (m === n && !opts?.force) return;
    n = m;
    retarget(false, opts?.immediate);
  };

  let started = false;
  stage.pointer.lastInput = performance.now();
  stage.onResize(() => {
    fit();
    if (!started) {
      started = true;
      n = 8;
      pitch = capH / n;
      retarget(false, true);
      if (stillN) {
        // The still: change the raster and stop the clock mid-rebuild.
        pitch = capH / stillN;
        setN(stillN);
        const at = clamp(+(q.get("at") || 0.15), 0, 4);
        for (let i = 0; i < at * 60; i++) simulate(1 / 60);
        frozen = true;
      }
    }
  });

  const pMin = () => Math.max(6, capH / N_MAX);
  const pMax = () => capH / N_MIN;

  stage.on("down", (p) => {
    drag = { x: p.x, lp: Math.log(pitch) };
    pitchV = 0;
    frozen = false;
    if (embedded) host.focus?.({ preventScroll: true });
  });
  stage.on("up", (p) => {
    if (!drag) return;
    pitchV = (p.vx / (stage.width * 0.7)) * Math.log(pMax() / pMin());
    drag = null;
  });

  // Typing sets a new word; a pause before the next key starts another.
  let lastKey = -1e9;
  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const tag = e.target?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const now = performance.now();
    let nextWord = word;
    if (e.key === "Backspace") {
      nextWord = word.slice(0, -1);
    } else if (/^[a-zA-Z0-9]$/.test(e.key)) {
      nextWord = (now - lastKey > 1400 ? "" : word) + e.key.toUpperCase();
      nextWord = nextWord.slice(0, 9);
    } else return;
    e.preventDefault();
    lastKey = now;
    frozen = false;
    stage.pointer.lastInput = now;
    if (!nextWord) nextWord = word.slice(0, 1) || DEFAULT_WORD;
    if (nextWord === word) return;
    word = nextWord;
    // Keep the raster's rows; the dots move to fit the new word.
    fit();
    retarget(true);
  };
  const keyScope = embedded ? host : window;
  if (embedded) host.tabIndex = 0;
  keyScope.addEventListener("keydown", onKey);

  const K = 520;
  const D = 2 * Math.sqrt(K) * 0.82;
  function simulate(dt) {
    time += dt;
    orgX = damp(orgX, orgT, 11, dt);
    for (const st of strokes) {
      if (time < st.due) continue;
      if (!st.born) {
        st.born = true;
        st.pts.forEach((p, i) => Object.assign(p, { x: st.target[i][0], y: st.target[i][1], vx: 0, vy: 0 }));
      }
      st.pts.forEach((p, i) => {
        const [tx, ty] = st.target[i];
        p.vx += (K * (tx - p.x) - D * p.vx) * dt;
        p.vy += (K * (ty - p.y) - D * p.vy) * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      });
    }
  }

  let autoT = 0;
  stage.onFrame((dt) => {
    const W = stage.width;
    const H = stage.height;
    const lo = Math.log(pMin());
    const hi = Math.log(pMax());
    const ptr = stage.pointer;

    if (!frozen) {
      let lp = Math.log(pitch);
      if (ptr.down && drag) {
        // Across most of the field is the whole range, right is coarser.
        lp = drag.lp + ((ptr.x - drag.x) / (W * 0.7)) * (hi - lo);
        // Past the ends it resists rather than stops.
        if (lp > hi) lp = hi + (lp - hi) * 0.25;
        if (lp < lo) lp = lo + (lp - lo) * 0.25;
        autoT = 0;
      } else if (stage.idleFor() > 7000 && !embedded) {
        // Left alone, the raster breathes slowly between coarse and fine.
        autoT += dt;
        const want = (lo + hi) / 2 + ((hi - lo) / 2) * 0.92 * Math.sin(autoT * 0.22 - 0.9);
        lp = damp(lp, want, 1.5, dt);
      } else {
        pitchV *= Math.exp(-4 * dt);
        lp += pitchV * dt;
        lp = clamp(lp, lo, hi);
        // Come to rest on a whole number of rows.
        if (Math.abs(pitchV) < 0.4) lp = damp(lp, Math.log(capH / clamp(Math.round(capH / Math.exp(lp)), N_MIN, N_MAX)), 9, dt);
      }
      pitch = Math.exp(lp);
      setN(Math.round(capH / pitch));
      simulate(dt);
    }

    // Draw.
    ctx.setTransform(stage.dpr, 0, 0, stage.dpr, 0, 0);
    ctx.fillStyle = "#f2f0eb";
    ctx.fillRect(0, 0, W, H);
    // The raster's origin is the word's: its first stem, on its baseline.
    const x0 = Math.round(W / 2) + orgX;
    const y0 = Math.round(H / 2) + capH / 2;
    const p = pitch;

    // The raster, in rows up from the baseline and columns out from the
    // first stem, so both always stand on a line of dots, even mid-drag.
    const r = clamp(p * 0.06, 0.75, 2.2);
    ctx.fillStyle = "rgba(24, 22, 20, 0.2)";
    const round = p > 14;
    ctx.beginPath();
    const i0 = -Math.ceil(x0 / p);
    const i1 = Math.ceil((W - x0) / p);
    const j0 = -Math.ceil((H - y0) / p);
    const j1 = Math.ceil(y0 / p);
    for (let j = j0; j <= j1; j++) {
      const y = y0 - j * p;
      for (let i = i0; i <= i1; i++) {
        const x = x0 + i * p;
        if (round) {
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
        } else ctx.rect(x - r, y - r, r * 2, r * 2);
      }
    }
    ctx.fill();

    // The letters: one stroke width of the raster (see inkCells).
    const sw = clamp(p * STROKE, capH * STROKE_MIN, capH * STROKE_MAX);
    ctx.strokeStyle = "#141210";
    ctx.lineWidth = sw;
    ctx.lineJoin = "miter";
    ctx.miterLimit = 4;
    // Butt caps, with orthogonal ends pushed out half a stroke so they land
    // square on their dot; a diagonal end always meets another stroke.
    ctx.lineCap = "butt";
    ctx.beginPath();
    // A diagonal end goes in only a fifth, enough to bury its corners in
    // the stroke it starts from.
    const ext = (P, i, step) => {
      const a = P[i];
      let b = a;
      for (let j = i + step; j >= 0 && j < P.length; j += step) {
        b = P[j];
        if (Math.abs(b.x - a.x) + Math.abs(b.y - a.y) > 1e-2) break;
      }
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const l = Math.hypot(dx, dy);
      if (l < 1e-2) return [x0 + a.x, y0 + a.y];
      const e = Math.min(Math.abs(dx), Math.abs(dy)) > l * 0.2 ? 0.2 : 0.5;
      return [x0 + a.x + (dx / l) * sw * e, y0 + a.y + (dy / l) * sw * e];
    };
    for (const st of strokes) {
      if (!st.born) continue;
      const P = st.pts;
      const L = P.length;
      for (let i = 0; i < L; i++) {
        let x = x0 + P[i].x;
        let y = y0 + P[i].y;
        if (!st.closed && i === 0 && L > 1) [x, y] = ext(P, 0, 1);
        if (!st.closed && i === L - 1 && L > 1) [x, y] = ext(P, L - 1, -1);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      if (st.closed) ctx.closePath();
    }
    ctx.stroke();
  });

  return {
    destroy() {
      keyScope.removeEventListener("keydown", onKey);
      stage.destroy();
    },
  };
}
