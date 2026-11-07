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
const GLYPHS = {
  A: [0.62, "LB LT* RT* RB | LM RM"],
  B: [0.62, "LB LT RT* RM* LM | LM RM* RB* LB"],
  C: [0.58, "RT LT* LB* RB"],
  D: [0.64, "LB LT RT* RB* z"],
  E: [0.56, "RT LT LB RB | LM RM"],
  F: [0.56, "RT LT LB | LM RM"],
  G: [0.62, "RT LT* LB* RB* RM CM"],
  H: [0.62, "LT LB | RT RB | LM RM"],
  I: [0, "CT CB"],
  J: [0.5, "RT RB* LB* L,M+1"],
  K: [0.6, "LT LB | LM RM# RT | LM RM# RB"],
  L: [0.52, "LT LB RB"],
  M: [0.86, "LB LT* RT* RB | CT CB"],
  N: [0.62, "LB LT* RT* RB"],
  O: [0.66, "LT* RT* RB* LB* z"],
  P: [0.6, "LB LT RT* RM* LM"],
  Q: [0.66, "RB LB* LT* RT* RB | RB R+1,B"],
  R: [0.6, "LB LT RT* RM* LM | CM RM# RB"],
  S: [0.6, "RT LT* LM* RM* RB* LB"],
  T: [0.62, "LT RT | CT CB"],
  U: [0.62, "LT LB* RB* RT"],
  V: [0.62, "LT LB# RB# RT"],
  W: [0.86, "LT LB* RB* RT | CB CM"],
  X: [0.62, "LT LM# RM# RT | LB LM# RM# RB"],
  Y: [0.62, "LT LM# RM# RT | CM CB"],
  Z: [0.6, "LT RT RM# LM# LB RB"],
  0: [0.54, "LT* RT* RB* LB* z | CM-1 CM+1"],
  1: [0.4, "LT CT# CB"],
  2: [0.58, "LT RT* RM* LM* LB RB"],
  3: [0.58, "LT RT* RB* LB | CM RM"],
  4: [0.6, "LT LM* RM | RT RB"],
  5: [0.58, "RT LT LM RM* RB* LB"],
  6: [0.58, "RT LT* LB* RB* RM* LM"],
  7: [0.56, "LT RT* RB"],
  8: [0.6, "LT* RT* RB* LB* z | LM RM"],
  9: [0.58, "LB RB* RT* LT* LM* RM"],
};

const parsed = {};
for (const [ch, [ratio, src]] of Object.entries(GLYPHS)) {
  parsed[ch] = {
    ratio,
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
const gapFor = (n) => Math.max(2, Math.round(n * 0.2));

// Lay out a word in cells around the raster's centre dot.
function layout(word, n) {
  const c = cutFor(n);
  const gap = gapFor(n);
  const glyphs = [...word].map((ch) => parsed[ch]);
  let x = 0;
  const placed = glyphs.map((g) => {
    const w = glyphWidth(g, n);
    const at = x;
    x += w + gap;
    return { g, at, w };
  });
  const total = Math.max(0, x - gap);
  const ox = -Math.floor(total / 2);
  const oy = -Math.floor(n / 2);
  return placed.map(({ g, at }) => resolve(g, n, c).map((s) => ({ closed: s.closed, pts: s.pts.map(([px, py]) => [px + at + ox, py + oy]) })));
}

// Width of a word in cap heights, for fitting it to the box.
// The widest the word gets at any raster, since rounding to whole cells
// widens a coarse one.
function aspect(word) {
  let most = 1;
  for (let n = N_MIN; n <= N_MAX; n++) {
    let w = 0;
    for (const ch of word) w += glyphWidth(parsed[ch], n) + gapFor(n);
    most = Math.max(most, (w - gapFor(n)) / n);
  }
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
  let strokes = [];

  const fit = () => {
    const W = stage.width;
    const H = stage.height;
    capH = Math.min(H * 0.4, (W * 0.8) / aspect(word));
  };

  const retarget = (spawn = false, immediate = false) => {
    const lay = layout(word, n);
    const next = [];
    let order = 0;
    const count = lay.reduce((s, g) => s + g.length, 0);
    const step = Math.min(0.018, 0.3 / Math.max(1, count));
    lay.forEach((glyph, gi) => {
      glyph.forEach((s, si) => {
        const key = `${gi}:${word[gi]}:${si}`;
        let st = strokes.find((o) => o.key === key);
        if (!st) {
          const first = s.pts[0];
          st = { key, closed: s.closed, born: immediate, pts: s.pts.map((p) => (immediate ? { x: p[0], y: p[1], vx: 0, vy: 0 } : { x: first[0], y: first[1], vx: 0, vy: 0 })) };
        }
        st.target = s.pts;
        st.due = immediate ? time : time + order * step + (spawn ? 0.04 : 0);
        order++;
        next.push(st);
      });
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
    } else {
      pitch = capH / n;
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
    for (const st of strokes) {
      if (time < st.due) continue;
      if (!st.born) {
        st.born = true;
        const f = st.target[0];
        for (const p of st.pts) Object.assign(p, { x: f[0], y: f[1], vx: 0, vy: 0 });
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
    const cx = Math.round(W / 2);
    const cy = Math.round(H / 2);
    const p = pitch;

    // The raster.
    const r = clamp(p * 0.06, 0.75, 2.2);
    ctx.fillStyle = "rgba(24, 22, 20, 0.2)";
    const round = p > 14;
    ctx.beginPath();
    const i0 = -Math.ceil(cx / p);
    const i1 = Math.ceil((W - cx) / p);
    const j0 = -Math.ceil(cy / p);
    const j1 = Math.ceil((H - cy) / p);
    for (let j = j0; j <= j1; j++) {
      const y = cy + j * p;
      for (let i = i0; i <= i1; i++) {
        const x = cx + i * p;
        if (round) {
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
        } else ctx.rect(x - r, y - r, r * 2, r * 2);
      }
    }
    ctx.fill();

    // The letters: one stroke width of the raster, bounded so a fine
    // raster still sets a word and a coarse one does not fill in.
    const sw = clamp(p * 0.78, capH * 0.05, capH * 0.16);
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
        if (Math.abs(b.x - a.x) + Math.abs(b.y - a.y) > 1e-3) break;
      }
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      const l = Math.hypot(dx, dy);
      if (l < 1e-3) return [cx + a.x * p, cy + a.y * p];
      const e = Math.min(Math.abs(dx), Math.abs(dy)) > l * 0.2 ? 0.2 : 0.5;
      return [cx + a.x * p + (dx / l) * sw * e, cy + a.y * p + (dy / l) * sw * e];
    };
    for (const st of strokes) {
      if (!st.born) continue;
      const P = st.pts;
      const L = P.length;
      for (let i = 0; i < L; i++) {
        let x = cx + P[i].x * p;
        let y = cy + P[i].y * p;
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
