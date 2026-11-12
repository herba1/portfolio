// One word, morphing letter by letter into the next, under your hand. The
// chain of words is a line you scrub: drag sideways (or swipe the trackpad)
// and the morph from this word to the next follows the pointer, at whatever
// point between them you hold it. Let go and a spring finishes it or puts it
// back, carrying the speed you let go with, so a flick runs on through
// several words.
//
// Each word is laid out once by the browser (real kerning, tracking from the
// house law), and every glyph is then set alone at the x the browser gave it.
// At display size and in semibold the law's tracking plus the font's kerning
// leaves some pairs touching (the arm of an r into the bar of a t), so the
// engine spaces the word itself: every glyph's ink is rasterised once, row by
// row, and a neighbour that would come nearer than SPACE ink to ink, in any
// direction, is set out to that distance, the rest of the word with it; then
// the word is centred on its ink. The same distance is held every frame while
// the word moves, so a sliding glyph never grazes the one beside it.
// A glyph two words share is the same element in both: its spring chases the
// place the scrub puts it, a lerp from its place in one word to its place in
// the other, so it lags the hand a touch and lands with a hair of overshoot.
//
// No glyph is ever left cut. A letter only one of the two words has is either
// whole or gone at any point you can hold the scrub: each one has a point on
// the scrub where it goes (a leaving letter: just before anything closes on
// it) or comes (a new one: once the gap it needs has opened), worked out from
// where the word will be, and crossing that point runs a short wipe in time,
// not in scrub, so the cut passes in a few frames and never holds. Letters
// only one word has ride a kept neighbour, so a leaving run is carried along
// and closes at a seam like a zipper instead of leaving a hole where it stood.
// Two glyphs' visible boxes never overlap; a new letter waits for anything in
// its ground to be gone before it wipes in.
//
// ?t=0.2 is a still 0.2s into a tap from word ?w to the next; ?p=0.4 holds
// the scrub 0.4 of the way there with every spring and wipe settled.

import { isDevView } from "@/lib/viewMode";

const WORDS = ["Help", "Hello", "Yellow", "Yes", "Yesterday", "Birthday", "Blackbird", "Bird", "Here", "There", "Helter"];
const N = WORDS.length;
const mod = (k) => ((k % N) + N) % N;

// Glyph springs, in Motion's terms: chase the scrub, settle in ~0.34s with a
// hair of overshoot. Mass 1.
const VISUAL = 0.34;
const BOUNCE = 0.12;
const K = (2 * Math.PI / VISUAL) ** 2;
const C = 2 * (1 - BOUNCE) * Math.sqrt(K);
// The scrub itself once let go: critically damped, so it never runs past the
// word it lands on.
const K_S = (2 * Math.PI / 0.5) ** 2;
const C_S = 2 * Math.sqrt(K_S);
const PROJECT = 0.24; // s of the release speed the landing word is chosen by
const FLICK = 0.6; // words/s: a release faster than this always moves on
const MAX_CHAIN = 6; // words one flick may run through
const SLOP = 5; // px of movement before a press becomes a drag
// The press: a stiffer, fully damped spring on the whole word.
const K_PRESS = 900;
const C_PRESS = 2 * Math.sqrt(K_PRESS);

const WIPE = 0.07; // s: a letter's wipe, in or out, once its point is crossed
const WIPE_GONE = 0.045; // s: a letter left over from a word already passed
// Points on the scrub (0 = this word, 1 = the next).
const GATE = {
  out: 0.015, // a leaving letter goes this far before a shared one reaches it
  sep: 0.05, // a new letter comes this far after one in its ground has gone
  first: 0.05, // the first new letter beside a kept one comes no sooner
  stagger: 0.06, // and each further one out from it this much later
  outMin: 0.03,
  outMax: 0.85,
  inMax: 0.94,
};
const GUTTER = 0.04; // em of ground kept between any two visible glyphs
const MIN_PIECE = 0.25; // em: no glyph is shown as a piece narrower than this
const PAD = 0.03; // em of slack around a glyph's ink, so clip edges stay clean
const SLACK = 0.006; // em two ink boxes may brush while a spring settles home
const SPACE = 0.04; // em: the least ink-to-ink distance between two whole neighbours
const RASTER_PX = 480; // a glyph's ink profile is rasterised at least this many px to the em
// Where on the scrub the kept glyphs travel. Before it the letters that go
// have gone; after it the word is set and the last new letters drop in, so
// the hand can hold each phase: leaving, sliding, arriving.
const MOVE = [0.08, 0.86];
const STEP = 1 / 240;
const SAMPLES = 240; // scrub points a pair's gates are worked out on

const lawPx = (s) => -0.043 * (s - 12);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (t) => t * t * (3 - 2 * t);

export async function createGlyphMorph(stage, { embedded = false, onLive = () => {} } = {}) {
  const params = new URLSearchParams(window.location.search);
  const holdT = params.has("t") ? clamp(parseFloat(params.get("t")) || 0, 0, 5) : null;
  const holdP = params.has("p") ? clamp(parseFloat(params.get("p")) || 0, -MAX_CHAIN, MAX_CHAIN) : null;
  const startAt = clamp(parseInt(params.get("w") || "0", 10) || 0, 0, N - 1);
  const runCheck = params.has("check") && isDevView();
  const still = holdT !== null || holdP !== null || runCheck;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const surface = document.createElement("div");
  surface.className = "gm-surface";
  surface.setAttribute("role", "slider");
  surface.setAttribute("aria-label", "Word");
  surface.setAttribute("aria-valuemin", "0");
  surface.setAttribute("aria-valuemax", String(N - 1));
  surface.tabIndex = 0;
  const wordEl = document.createElement("div");
  wordEl.className = "gm-word";
  surface.append(wordEl);
  const meter = document.createElement("div");
  meter.className = "gm-meter";
  meter.setAttribute("aria-hidden", "true");
  surface.append(meter);
  stage.append(surface);

  try {
    await document.fonts.load(`600 100px ${getComputedStyle(meter).fontFamily}`);
    await document.fonts.ready;
  } catch {}

  const box = stage.closest(".piece-box") || stage;
  let W = 0;
  let H = 0;
  let size = 0;
  let baseTop = 0; // top of a glyph box so its baseline sits on the line
  let layouts = []; // per word: { x: absolute lefts }
  let D = 400; // px of drag per word
  let field = [0, 0]; // where a glyph's ink may go: the page less a margin
  let originY = 0;
  let inkCtx = null;
  let inkCache = new Map();
  let reqCache = new Map();

  // The scrub: s is a place on the chain of words, base the word the current
  // pair starts from. P = s - base runs 0..1 from WORDS[base] to the next.
  let s = startAt;
  let sv = 0;
  let sTarget = startAt;
  let mode = "rest"; // "rest" | "spring" | "drag" | "wheel"
  let base = startAt;
  let A = []; // glyphs of WORDS[base], in order
  let B = []; // glyphs of WORDS[base + 1], in order
  let glyphs = []; // A and B together
  let leftovers = []; // glyphs of a word already passed, wiping out
  let said = -1;

  let clock = 0;
  let raf = 0;
  let last = 0;
  let acc = 0;
  let destroyed = false;
  let press = 1;
  let pressV = 0;
  let pressT = 1;

  const measureWord = (word) => {
    meter.textContent = word;
    const node = meter.firstChild;
    const origin = meter.getBoundingClientRect().left;
    const range = document.createRange();
    const lefts = [];
    for (let i = 0; i < word.length; i += 1) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      lefts.push(range.getBoundingClientRect().left - origin);
    }
    range.setStart(node, word.length - 1);
    range.setEnd(node, word.length);
    const end = range.getBoundingClientRect().right - origin;
    return { lefts, end };
  };

  const setMeter = (sz) => {
    meter.style.fontSize = `${sz}px`;
    meter.style.lineHeight = `${Math.round(sz)}px`;
    const track = lawPx(sz);
    meter.style.letterSpacing = sz >= 20 ? `${(track / sz).toFixed(4)}em` : `${track.toFixed(2)}px`;
    return track;
  };

  const layout = () => {
    const r = box.getBoundingClientRect();
    W = r.width;
    H = r.height;
    if (!W || !H) return false;
    D = clamp(W * 0.32, 180, 440);
    // Fit the widest word: width(s) = adv100 * s / 100 + law(s) * (n - 1).
    setMeter(100);
    meter.style.letterSpacing = "0";
    const side = Math.max(24, W * (W < 640 ? 0.07 : 0.1));
    field = [side * 0.4, W - side * 0.4];
    const room = W - side * 2;
    let fit = Infinity;
    for (const w of WORDS) {
      const { end } = measureWord(w);
      const n = w.length - 1;
      fit = Math.min(fit, (room - 0.516 * n) / (end / 100 - 0.043 * n));
    }
    const first = Math.round(clamp(Math.min(fit, H * 0.42, 340), 24, 340));
    setSize(first);
    // The spacing the engine adds can widen a word past the room the line
    // was fitted to; if it does, set everything again a touch smaller.
    const widest = Math.max(...layouts.map((l) => l.ink[1] - l.ink[0]));
    if (widest > room + 0.5) setSize(Math.max(24, Math.floor((first * room) / widest)));
    meter.textContent = "";
    wordEl.style.transformOrigin = `${W / 2}px ${originY}px`;
    return true;
  };

  // Set the word at one size: the glyph box's top for the baseline, the ink
  // measures, and every word's glyph positions.
  const setSize = (sz) => {
    size = sz;
    setMeter(size);
    // Baseline: a zero-size inline-block sits on it.
    meter.textContent = "H";
    const probe = document.createElement("span");
    probe.className = "gm-probe";
    meter.append(probe);
    const baseOff = probe.getBoundingClientRect().top - meter.getBoundingClientRect().top;
    inkCtx = document.createElement("canvas").getContext("2d");
    inkCtx.font = `600 ${size}px ${getComputedStyle(meter).fontFamily}`;
    inkCache = new Map();
    reqCache = new Map();
    const cap = inkCtx.measureText("H").actualBoundingBoxAscent || size * 0.71;
    // Centre the cap band, nudged a touch above true centre.
    const baseline = Math.round(H / 2 + cap / 2 - H * 0.015);
    baseTop = baseline - baseOff;
    originY = baseline - cap / 2;
    layouts = WORDS.map((w) => {
      const { lefts } = measureWord(w);
      // Space it: a pair the line sets nearer than SPACE ink to ink is set
      // out to it, and everything after moves with the right-hand glyph.
      const xs = [...lefts];
      const nudges = [];
      for (let i = 1; i < xs.length; i += 1) {
        const short = reqOf(w[i - 1], w[i]) - (xs[i] - xs[i - 1]);
        if (short <= 0) continue;
        nudges.push(`${w[i - 1]}${w[i]} +${(short / size).toFixed(3)}em`);
        for (let j = i; j < xs.length; j += 1) xs[j] += short;
      }
      // Centre it on its ink, not on its advances.
      const ink = [xs[0] + inkOf(w[0]).l, xs[xs.length - 1] + inkOf(w[w.length - 1]).r];
      const x0 = (W - ink[0] - ink[1]) / 2;
      return { x: xs.map((l) => x0 + l), ink, nudges };
    });
  };

  // Where a glyph's upright strokes are: runs of columns, from its ink's
  // left edge, holding an unbroken stretch of ink at least half as tall as
  // the glyph's longest one. A wipe's edge never lands inside one, so no stem
  // or bowl side is left as a hairline beside a clean edge.
  const strokeRuns = (ch, l, r) => {
    if (!inkCtx) return [];
    const w = Math.ceil(r - l) + 2;
    const h = Math.ceil(size * 1.5);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    if (!ctx) return [];
    ctx.font = inkCtx.font;
    ctx.fillText(ch, 1 - l, Math.round(size * 1.1));
    const data = ctx.getImageData(0, 0, w, h).data;
    const cols = new Array(w).fill(0);
    for (let x = 0; x < w; x += 1) {
      let run = 0;
      for (let y = 0; y < h; y += 1) {
        run = data[(y * w + x) * 4 + 3] > 127 ? run + 1 : 0;
        if (run > cols[x]) cols[x] = run;
      }
    }
    const tall = Math.max(...cols) * 0.5;
    const runs = [];
    let from = -1;
    for (let x = 0; x <= w; x += 1) {
      const on = x < w && cols[x] >= tall;
      if (on && from < 0) from = x;
      if (!on && from >= 0) {
        runs.push([from - 2, x]);
        from = -1;
      }
    }
    return runs;
  };

  // A glyph's ink, left and right of its own box's left edge.
  const inkOf = (ch) => {
    let m = inkCache.get(ch);
    if (!m) {
      const t = inkCtx ? inkCtx.measureText(ch) : null;
      const l = t ? -(t.actualBoundingBoxLeft || 0) : 0;
      const r = t ? t.actualBoundingBoxRight || t.width : size * 0.6;
      m = { l, r, w: r - l, runs: strokeRuns(ch, l, r), rows: profile(ch, l, r) };
      inkCache.set(ch, m);
    }
    return m;
  };

  // A glyph's ink row by row, oversampled: for each row of the raster, its
  // leftmost and rightmost inked edge in px from the glyph box's left edge
  // (NaN where the row is empty). Rows share the baseline across glyphs, so
  // two glyphs' rows line up. A pixel counts as ink from half coverage, where
  // the eye puts the edge.
  const profile = (ch, l, r) => {
    const R = Math.max(1, Math.ceil(RASTER_PX / size));
    const pad = 2;
    const w = Math.ceil((r - l + pad * 2) * R);
    const h = Math.ceil(size * 1.5 * R);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    const left = new Float32Array(h).fill(NaN);
    const right = new Float32Array(h).fill(NaN);
    if (!ctx || !inkCtx) return { R, left, right };
    ctx.font = inkCtx.font.replace(/\d+(\.\d+)?px/, `${size * R}px`);
    const ox = (pad - l) * R;
    ctx.fillText(ch, ox, Math.round(size * 1.1 * R));
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let y = 0; y < h; y += 1) {
      let a = -1;
      let b = -1;
      for (let x = 0; x < w; x += 1) {
        if (data[(y * w + x) * 4 + 3] < 128) continue;
        if (a < 0) a = x;
        b = x;
      }
      if (a < 0) continue;
      left[y] = (a - ox) / R;
      right[y] = (b + 1 - ox) / R;
    }
    return { R, left, right };
  };

  // The least distance, pen to pen, glyph b may sit right of glyph a with
  // their ink still SPACE apart in every direction: each row of b's left edge
  // against a's right edge in the rows within SPACE of it, the vertical step
  // taken off the room it needs, so corners that only meet on the diagonal
  // are held to the same distance as edges that face each other.
  const reqOf = (a, b) => {
    const key = a + b;
    let d = reqCache.get(key);
    if (d === undefined) {
      const pa = inkOf(a).rows;
      const pb = inkOf(b).rows;
      const R = pa.R;
      const gap = SPACE * size;
      const reach = Math.floor(gap * R);
      d = -Infinity;
      for (let y = 0; y < pb.left.length; y += 1) {
        const bl = pb.left[y];
        if (Number.isNaN(bl)) continue;
        for (let k = -reach; k <= reach; k += 1) {
          const ar = pa.right[y + k];
          if (ar === undefined || Number.isNaN(ar)) continue;
          const dy = k / R;
          const want = ar - bl + Math.sqrt(Math.max(0, gap * gap - dy * dy));
          if (want > d) d = want;
        }
      }
      reqCache.set(key, d);
    }
    return d;
  };

  const styleGlyph = (g) => {
    g.el.style.fontSize = `${size}px`;
    g.el.style.lineHeight = `${Math.round(size)}px`;
    g.el.style.top = `${baseTop}px`;
    g.ink = inkOf(g.ch);
    g.drawn = "";
  };

  // role: "kept" (in both words), "a" (only in this word), "b" (only in the
  // next), "gone" (left over from a word already passed). w is how much of
  // it shows, 0..1, and edge the side its visible part holds to while wiping.
  const makeGlyph = (ch, x) => {
    const el = document.createElement("span");
    el.className = "gm-glyph";
    el.setAttribute("aria-hidden", "true");
    el.textContent = ch;
    wordEl.append(el);
    const g = { ch, el, x, dx: 0, v: 0, xa: null, xb: null, ai: -1, bi: -1, role: "kept", anchor: null, err: 0, w: 0, edge: -1, pIn: 0, pOut: 1, vis: null, drawn: "" };
    styleGlyph(g);
    return g;
  };

  const inkL = (g, x = g.x) => x + g.ink.l;
  const inkR = (g, x = g.x) => x + g.ink.r;
  // Which side of the page a glyph's ink would cross at x: 0 when inside.
  const outside = (g, x = g.x) => (inkL(g, x) < field[0] ? -1 : inkR(g, x) > field[1] ? 1 : 0);
  const mid = (g, x = g.x) => x + (g.ink.l + g.ink.r) / 2;

  // Ground two glyphs need between their ink boxes (l left of r): the
  // gutter, but neighbours in either word need only what that word itself
  // leaves them.
  const need = (l, r) => {
    if (l.bi >= 0 && B[l.bi + 1] === r) return Math.min(0, inkL(r, r.xb) - inkR(l, l.xb));
    if (l.ai >= 0 && A[l.ai + 1] === r) return Math.min(0, inkL(r, r.xa) - inkR(l, l.xa));
    return GUTTER * size;
  };
  // How far apart two glyphs are past the ground they need: under 0, too close.
  const room = (g, xg, h, xh) => (mid(g, xg) <= mid(h, xh) ? inkL(h, xh) - inkR(g, xg) - need(g, h) : inkL(g, xg) - inkR(h, xh) - need(h, g));

  const travel = (P) => smooth(clamp((P - MOVE[0]) / (MOVE[1] - MOVE[0]), 0, 1));
  // Where the scrub puts a glyph at P, once its spring has caught up.
  const target = (g, P) => {
    if (g.role === "kept") return g.xa + (g.xb - g.xa) * travel(P);
    if (g.role === "a") return g.anchor ? target(g.anchor.g, P) + g.anchor.off : g.xa;
    if (g.role === "b") return g.anchor ? target(g.anchor.g, P) + g.anchor.off : g.xb;
    return g.x;
  };

  // Which glyphs of a word carry over to another: the longest run of letters
  // the two share in order (so no glyph ever slides through another), and
  // among equally long runs the one that moves the glyphs least.
  const match = (from, fx, word, xs) => {
    const n = from.length;
    const m = word.length;
    const best = Array.from({ length: n + 1 }, () => Array(m + 1).fill(null));
    for (let i = n; i >= 0; i -= 1) {
      for (let j = m; j >= 0; j -= 1) {
        if (i === n || j === m) {
          best[i][j] = { c: 0, d: 0 };
          continue;
        }
        let pick = best[i + 1][j];
        const alt = best[i][j + 1];
        if (alt.c > pick.c || (alt.c === pick.c && alt.d < pick.d)) pick = alt;
        if (from[i].ch === word[j]) {
          const t = best[i + 1][j + 1];
          const take = { c: t.c + 1, d: t.d + Math.abs(fx[i] - xs[j]) };
          if (take.c > pick.c || (take.c === pick.c && take.d < pick.d)) pick = { ...take, take: true };
        }
        best[i][j] = pick.take && pick !== best[i + 1][j] && pick !== best[i][j + 1] ? pick : { c: pick.c, d: pick.d };
      }
    }
    const pairs = new Map(); // index in word -> glyph of from
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      const here = best[i][j];
      if (here.take) {
        pairs.set(j, from[i]);
        i += 1;
        j += 1;
      } else if (best[i + 1][j].c === here.c && best[i + 1][j].d === here.d) i += 1;
      else j += 1;
    }
    return pairs;
  };

  // Set up the pair WORDS[k] -> WORDS[k + 1] around the glyphs of one of its
  // words (the one the scrub is coming from), making the other's.
  const buildPair = (k, from, fromIsA) => {
    const ka = mod(k);
    const kb = mod(k + 1);
    const other = fromIsA ? kb : ka;
    const word = WORDS[other];
    const xs = layouts[other].x;
    const fx = layouts[fromIsA ? ka : kb].x;
    const pairs = match(from, fx, word, xs);
    const made = [...word].map((ch, j) => {
      let g = pairs.get(j);
      if (!g) {
        // A letter still showing from a word just passed, close by, comes back.
        let near = -1;
        let nd = size * 0.35;
        leftovers.forEach((o, q) => {
          const d = Math.abs(o.x - xs[j]);
          if (o.ch === ch && o.w > 0 && d < nd) [near, nd] = [q, d];
        });
        if (near >= 0) [g] = leftovers.splice(near, 1);
        else g = makeGlyph(ch, xs[j]);
      }
      return g;
    });
    const prev = glyphs;
    A = fromIsA ? from : made;
    B = fromIsA ? made : from;
    for (const g of [...A, ...B]) {
      g.ai = -1;
      g.bi = -1;
      g.xa = null;
      g.xb = null;
    }
    A.forEach((g, i) => {
      g.ai = i;
      g.xa = layouts[ka].x[i];
    });
    B.forEach((g, j) => {
      g.bi = j;
      g.xb = layouts[kb].x[j];
    });
    glyphs = [...new Set([...A, ...B])];
    for (const g of prev) if (!glyphs.includes(g) && !leftovers.includes(g)) leftovers.push(g);
    for (const g of leftovers) {
      g.role = "gone";
      g.anchor = null;
    }
    for (const g of glyphs) {
      const was = g.anchor;
      g.anchor = null;
      g.role = g.ai >= 0 && g.bi >= 0 ? "kept" : g.ai >= 0 ? "a" : "b";
      if (was && g.role !== "b") {
        // It rode a kept glyph; it carries on from where it was, at its pace.
        g.err = 0;
      }
    }

    // Letters only one word has ride a kept neighbour of theirs in that word,
    // at their place in it: a new one shows up already set beside the glyph
    // it grows from, and a leaving one is carried along by the glyph it
    // stood beside, so the word stays packed and never opens a hole. A run
    // of them between two kept glyphs is split between both at a seam,
    // placed where the glyphs either side of it are wide enough to show a
    // piece, as near the middle of the run as that allows. Leaving runs
    // close at their seam, new ones open at theirs.
    const wide = 0.4 * size;
    const rideRuns = (list, key, index) => {
      const ride = (j, anchor, rank, run) => {
        const g = list[j];
        g.rank = rank;
        g.run = run;
        if (!anchor) {
          g.edge = -1;
          return;
        }
        g.edge = anchor[index] < j ? -1 : 1;
        g.anchor = { g: anchor, off: g[key] - anchor[key] };
        const at = anchor.x + g.anchor.off;
        if (g.w > 0) g.err = g.x - at;
        else {
          g.err = 0;
          g.x = at;
        }
        g.v = anchor.v;
      };
      const keptAt = list.map((g, j) => (g.role === "kept" ? j : -1)).filter((j) => j >= 0);
      const bounds = [-1, ...keptAt, list.length];
      for (let q = 0; q + 1 < bounds.length; q += 1) {
        const L = bounds[q];
        const R = bounds[q + 1];
        const n = R - L - 1;
        if (n <= 0) continue;
        const a = L >= 0 ? list[L] : null;
        const b = R < list.length ? list[R] : null;
        if (!a && !b) {
          for (let j = L + 1; j < R; j += 1) ride(j, null, j - L, n);
          continue;
        }
        let split = a ? n : 0; // how many ride the left one
        if (a && b) {
          let best = -Infinity;
          for (let k2 = 0; k2 <= n; k2 += 1) {
            const edge = [k2 > 0 ? list[L + k2] : null, k2 < n ? list[L + k2 + 1] : null].filter(Boolean);
            const score = Math.min(...edge.map((g) => Math.min(g.ink.w, wide))) * 100 - Math.abs(k2 - n / 2) - (k2 < n / 2 ? 0.1 : 0);
            if (score > best) [best, split] = [score, k2];
          }
        }
        for (let j = L + 1; j < R; j += 1) {
          if (j - L - 1 < split) ride(j, a, j - L, split);
          else ride(j, b, R - j, n - split);
        }
      }
    };
    rideRuns(B, "xb", "bi");
    rideRuns(A, "xa", "ai");
    gates();
  };

  // The points on the scrub where each letter only one word has comes or
  // goes, worked out on where the springs are headed.
  const gates = () => {
    const kept = glyphs.filter((g) => g.role === "kept");
    const aOnly = glyphs.filter((g) => g.role === "a");
    const bOnly = glyphs.filter((g) => g.role === "b");
    const Ps = Array.from({ length: SAMPLES + 1 }, (_, k) => k / SAMPLES);
    const roomAt = (g, h, P) => room(g, target(g, P), h, target(h, P));
    const sideOf = (g, h, P) => (mid(h, target(h, P)) >= mid(g, target(g, P)) ? 1 : -1);

    // A leaving letter goes just before anything still showing comes nearer
    // to it than it already is, and is cut from that side. They are settled
    // out from the kept glyph each rides, so where two leaving runs meet the
    // seam closes letter by letter, the outermost first. One nothing reaches
    // peels off from the free end of its run, early, while the word slides.
    const outOrder = [...aOnly].sort((p, q) => (p.rank || 1) - (q.rank || 1) || p.ai - q.ai);
    const settledOut = [];
    for (const d of outOrder) {
      d.pOut = null;
      const near = (h, P) => roomAt(d, h, P) < Math.min(0, roomAt(d, h, 0)) - 0.25;
      for (const P of Ps) {
        const hit = kept.find((h) => near(h, P)) || settledOut.find((h) => P < h.pOut && near(h, P));
        if (hit) {
          d.pOut = Math.max(GATE.outMin, P - GATE.out);
          d.edge = -sideOf(d, hit, P);
          break;
        }
      }
      if (d.pOut === null) d.pOut = GATE.outMin + GATE.stagger * ((d.run || 1) - (d.rank || 1));
      // Carried toward the edge of the page, it goes before it gets there.
      const off = Ps.find((P) => P < d.pOut && outside(d, target(d, P)));
      if (off !== undefined) {
        d.pOut = Math.max(GATE.outMin, off - GATE.out);
        d.edge = -outside(d, target(d, off));
      }
      settledOut.push(d);
    }
    // A new letter comes once its ground is clear for the rest of the way:
    // of every kept glyph, and of every new one already set to show there.
    // They are settled one at a time, out from the kept glyph each grows
    // from, so the first to fit drops in first and the last waits for the
    // ground the others leave it.
    // Its ground (and the page edge) counts as clear with SLACK to spare, so
    // a spring still settling in when the hand stops there does not hold it
    // back. (A neighbour it is set against in the next word needs only the
    // room that word leaves it.)
    const firm = SLACK * size;
    const tight = (e, h, P) => roomAt(e, h, P) < Math.min(firm, roomAt(e, h, 1) - 0.25);
    const edgy = (e, P) => inkL(e, target(e, P)) < field[0] + firm || inkR(e, target(e, P)) > field[1] - firm;
    const order = [...bOnly].sort((p, q) => (p.rank || 1) - (q.rank || 1) || p.bi - q.bi);
    const settledIn = [];
    for (const e of order) {
      let open = 0;
      for (let k = SAMPLES; k >= 0; k -= 1) {
        const P = Ps[k];
        if (edgy(e, P) || kept.some((h) => tight(e, h, P)) || settledIn.some((h) => P >= h.pIn && tight(e, h, P))) {
          open = Math.min(1, (k + 1) / SAMPLES);
          break;
        }
      }
      e.pIn = Math.max(open, Math.min(GATE.inMax, GATE.first + GATE.stagger * ((e.rank || 1) - 1)));
      settledIn.push(e);
    }
    // A leaving letter in a new one's ground is gone before the new one could
    // touch it; if that would be at the very start, the new one waits.
    for (let it = 0; it < 3; it += 1) {
      for (const e of bOnly) {
        for (const d of aOnly) {
          const P = Ps.find((p) => p >= e.pIn - 1e-9 && roomAt(e, d, p) < -0.25);
          if (P === undefined) continue;
          const lim = P - GATE.sep;
          if (lim < d.pOut) d.pOut = Math.max(GATE.outMin, lim);
          if (d.pOut > lim) e.pIn = Math.max(e.pIn, d.pOut + GATE.sep);
        }
      }
    }
    for (const d of aOnly) d.pOut = clamp(d.pOut ?? GATE.late, GATE.outMin, GATE.outMax);
    for (const e of bOnly) e.pIn = clamp(e.pIn, GATE.first, 1);
  };

  // A fresh pair around word k, every glyph of it whole and at rest.
  const jump = (k) => {
    for (const g of [...glyphs, ...leftovers]) g.el.remove();
    glyphs = [];
    leftovers = [];
    A = [];
    B = [];
    s = k;
    sv = 0;
    sTarget = k;
    mode = "rest";
    base = Math.floor(k);
    const w = mod(base);
    const word = [...WORDS[w]].map((ch, i) => {
      const g = makeGlyph(ch, layouts[w].x[i]);
      g.w = 1;
      return g;
    });
    buildPair(base, word, true);
    const P = s - base;
    for (const g of glyphs) {
      g.x = target(g, P);
      g.v = 0;
    }
    settleVis(P);
  };

  // Follow the scrub across a word: the next word's glyphs become the start
  // of the next pair, or this word's the end of the one before.
  const rebase = () => {
    while (Math.floor(s) > base) {
      base += 1;
      buildPair(base, B, true);
    }
    while (Math.floor(s) < base) {
      base -= 1;
      buildPair(base, A, false);
    }
  };

  // Is a glyph's ground clear of every glyph showing now?
  const clear = (g) => !outside(g) && [...glyphs, ...leftovers].every((h) => h === g || h.w <= 0 || room(g, g.x, h, h.x) >= -0.25 - SLACK * size);

  // Is a showing glyph about to reach this one within a wipe?
  const closing = (g) => {
    for (const h of glyphs) {
      // A leaving letter only yields to one that stays longer than it.
      if (h === g || h.w <= 0 || (h.role === "a" && (g.role !== "a" || h.pOut <= g.pOut))) continue;
      const right = mid(h) >= mid(g);
      const u = right ? g.v - h.v : h.v - g.v; // px/s it closes on g
      const now = room(g, g.x, h, h.x);
      if (now - Math.max(0, u) * WIPE * 1.5 < -0.25 - SLACK * size) return right ? 1 : -1;
    }
    return 0;
  };

  const visibility = (dt, P) => {
    const rate = dt / WIPE;
    const aOnly = glyphs.filter((g) => g.role === "a");
    const bOnly = glyphs.filter((g) => g.role === "b");
    const order = [...glyphs.filter((g) => g.role === "kept"), ...(P >= 0.5 ? [...bOnly, ...aOnly] : [...aOnly, ...bOnly]), ...leftovers];
    for (const g of order) {
      let want = true;
      let from = 0;
      if (g.role === "a") {
        from = closing(g) || outside(g, g.x + g.v * WIPE * 1.5);
        want = P < g.pOut && !from;
      } else if (g.role === "b") want = P >= g.pIn;
      else if (g.role === "gone") {
        want = false;
        // Run over in a flick: it is gone at once.
        if (closing(g)) g.w = 0;
      }
      if (want) {
        if (g.w < 1 && (g.w > 0 || clear(g))) g.w = Math.min(1, g.w + rate);
      } else if (g.w > 0) {
        if (g.w >= 1 && from) g.edge = -from;
        if (g.w >= 1 && g.role === "gone") {
          const h = glyphs.filter((o) => o.w > 0).sort((p, q) => Math.abs(mid(p) - mid(g)) - Math.abs(mid(q) - mid(g)))[0];
          g.edge = h && mid(h) > mid(g) ? -1 : 1;
        }
        g.w = Math.max(0, g.w - (g.role === "gone" ? dt / WIPE_GONE : rate));
      }
    }
  };

  // Hold every two neighbours on screen to their spacing while the word
  // moves: a shared glyph sliding (or overshooting home) toward a neighbour
  // closer than SPACE ink to ink pushes it, half each way, so neither grazes
  // the other. It is a set-off on top of where the springs have them, not a
  // change to the springs; at rest every word already holds its spacing, so
  // it is zero. A glyph mid-wipe counts as much as it shows, so the push
  // eases in and out with it instead of jumping.
  const space = () => {
    const all = [...glyphs, ...leftovers];
    for (const g of all) g.dx = 0;
    const list = all.filter((g) => g.w > 0).sort((p, q) => mid(p) - mid(q));
    if (list.length < 2) return;
    const wt = list.map((g) => smooth(clamp(g.w, 0, 1)));
    const want = [];
    for (let i = 0; i + 1 < list.length; i += 1) {
      const [g, h] = [list[i], list[i + 1]];
      const at = h.x - g.x;
      want.push(at + Math.min(wt[i], wt[i + 1]) * Math.max(0, reqOf(g.ch, h.ch) - at));
    }
    for (let it = 0; it < 40; it += 1) {
      let moved = false;
      for (let i = 0; i + 1 < list.length; i += 1) {
        const [g, h] = [list[i], list[i + 1]];
        const d = want[i] - (h.x + h.dx - g.x - g.dx);
        if (d <= 0.02) continue;
        g.dx -= d / 2;
        h.dx += d / 2;
        moved = true;
      }
      if (!moved) break;
    }
  };

  // Hold the scrub at P with every spring caught up and every wipe done.
  const settleVis = (P) => {
    for (let i = 0; i < 120; i += 1) visibility(STEP * 4, P);
    leftovers = leftovers.filter((g) => {
      if (g.w > 0) return true;
      g.el.remove();
      return false;
    });
    space();
    for (const g of [...glyphs, ...leftovers]) g.vis = visOf(g);
  };

  // A glyph's visible span, in stage px, as a closed piece of its ink box:
  // null when hidden. Pieces under MIN_PIECE are not shown, and an edge
  // never lands inside an upright stroke.
  const piece = (g, A0, B0) => {
    const minW = Math.min(MIN_PIECE * size, g.ink.w);
    const o = inkL(g);
    let a = A0;
    let b = B0;
    for (const [r0, r1] of g.ink.runs) {
      if (a > o + 0.01 && a > o + r0 && a < o + r1) a = o + r1;
      if (b < inkR(g) - 0.01 && b > o + r0 && b < o + r1) b = o + r0;
    }
    if (b - a < minW - 0.01) return null;
    return [a, b];
  };

  const visOf = (g) => {
    if (g.w >= 1) return [inkL(g), inkR(g)];
    if (g.w <= 0) return null;
    const f = smooth(g.w);
    const minW = MIN_PIECE * size;
    if (g.ink.w < minW) return f >= 0.5 ? [inkL(g), inkR(g)] : null;
    const reach = minW + (g.ink.w - minW) * f;
    return g.edge < 0 ? piece(g, inkL(g), inkL(g) + reach) : piece(g, inkR(g) - reach, inkR(g));
  };

  const release = (v) => {
    const proj = s + v * PROJECT;
    let t = Math.round(proj);
    if (v > FLICK) t = Math.max(t, Math.floor(s) + 1);
    if (v < -FLICK) t = Math.min(t, Math.ceil(s) - 1);
    const r = Math.round(s);
    sTarget = clamp(t, r - MAX_CHAIN, r + MAX_CHAIN);
    sv = v;
    mode = "spring";
    if (reduced) {
      s = sTarget;
      sv = 0;
    }
    kick();
  };

  const step = (dt) => {
    clock += dt;
    let busy = false;
    if (mode === "spring") {
      sv += (-K_S * (s - sTarget) - C_S * sv) * dt;
      s += sv * dt;
      if (Math.abs(s - sTarget) < 1e-3 && Math.abs(sv) < 1e-2) {
        s = sTarget;
        sv = 0;
        mode = "rest";
      } else busy = true;
    } else if (mode !== "rest") busy = true;
    rebase();
    const P = s - base;
    for (const g of glyphs) {
      if (g.anchor) continue;
      const tx = target(g, P);
      if (reduced) {
        g.x = tx;
        g.v = 0;
        continue;
      }
      g.v += (-K * (g.x - tx) - C * g.v) * dt;
      g.x += g.v * dt;
      if (Math.abs(g.x - tx) < 0.01 && Math.abs(g.v) < 0.01) {
        g.x = tx;
        g.v = 0;
      } else busy = true;
    }
    for (const g of glyphs) {
      if (!g.anchor) continue;
      const { g: a, off } = g.anchor;
      g.err *= Math.exp(-dt * 30);
      if (Math.abs(g.err) < 0.01) g.err = 0;
      else busy = true;
      g.x = a.x + off + g.err;
      g.v = a.v;
    }
    visibility(dt, P);
    leftovers = leftovers.filter((g) => {
      if (g.w > 0) return true;
      g.el.remove();
      return false;
    });
    space();
    for (const g of [...glyphs, ...leftovers]) g.vis = visOf(g);
    if (leftovers.length || glyphs.some((g) => g.w > 0 && g.w < 1)) busy = true;
    pressV += (-K_PRESS * (press - pressT) - C_PRESS * pressV) * dt;
    press += pressV * dt;
    if (Math.abs(press - pressT) < 1e-4 && Math.abs(pressV) < 1e-4) {
      press = pressT;
      pressV = 0;
    } else busy = true;
    return busy;
  };

  const draw = (g) => {
    const v = g.vis;
    const full = v && v[0] <= inkL(g) + 0.01 && v[1] >= inkR(g) - 0.01;
    // Clip in the glyph's own box; a side the clip does not cut keeps slack.
    let a = 0;
    let b = 0;
    if (v && !full) {
      a = v[0] <= inkL(g) + 0.01 ? g.ink.l - PAD * size : v[0] - g.x;
      b = v[1] >= inkR(g) - 0.01 ? g.ink.r + PAD * size : v[1] - g.x;
    }
    const x = g.x + g.dx;
    const str = !v ? "hidden" : full ? `${x.toFixed(2)}|full` : `${x.toFixed(2)}|${a.toFixed(1)}|${b.toFixed(1)}`;
    if (str === g.drawn) return;
    g.drawn = str;
    if (!v) {
      g.el.style.visibility = "hidden";
      return;
    }
    g.el.style.visibility = "";
    g.el.style.transform = `translate3d(${x.toFixed(2)}px,0,0)`;
    if (full) g.el.style.clipPath = "none";
    else {
      const t = (-0.4 * size).toFixed(1);
      const bt = (1.4 * size).toFixed(1);
      g.el.style.clipPath = `polygon(${a.toFixed(1)}px ${t}px,${b.toFixed(1)}px ${t}px,${b.toFixed(1)}px ${bt}px,${a.toFixed(1)}px ${bt}px)`;
    }
  };

  const say = () => {
    const k = mod(Math.round(s));
    surface.setAttribute("aria-valuenow", String(k));
    surface.setAttribute("aria-valuetext", WORDS[k]);
    if (mode === "rest" && k !== said) {
      said = k;
      onLive(WORDS[k]);
    }
  };

  const render = () => {
    for (const g of glyphs) draw(g);
    for (const g of leftovers) draw(g);
    wordEl.style.transform = press === 1 ? "" : `scale(${press.toFixed(4)})`;
    say();
  };

  const frame = (now) => {
    raf = 0;
    if (destroyed) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    acc += dt;
    let busy = true;
    while (acc >= STEP) {
      busy = step(STEP);
      acc -= STEP;
    }
    render();
    if (busy || mode === "drag" || mode === "wheel") raf = requestAnimationFrame(frame);
  };

  const kick = () => {
    if (raf || destroyed || still) return;
    last = performance.now();
    acc = 0;
    raf = requestAnimationFrame(frame);
  };

  // A tap or a key: on to the next word (or back), from wherever the scrub
  // is headed, so pressing again mid-morph runs on.
  const advance = (dir) => {
    const from = mode === "spring" ? sTarget : Math.round(s);
    sTarget = from + dir;
    if (Math.abs(sTarget - s) > MAX_CHAIN) sTarget = Math.round(s) + dir * MAX_CHAIN;
    mode = "spring";
    if (reduced) {
      s = sTarget;
      sv = 0;
    }
    kick();
  };

  // The drag: s follows the pointer, a word per D px, leftward onward.
  let drag = null;
  const speed = (samples) => {
    const now = performance.now();
    const recent = samples.filter((q) => now - q.t < 90);
    if (recent.length < 2) return 0;
    const [p, q] = [recent[0], recent[recent.length - 1]];
    if (now - q.t > 60 || q.t - p.t < 8) return 0;
    return clamp((q.s - p.s) / ((q.t - p.t) / 1000), -40, 40);
  };
  const onDown = (e) => {
    if (e.button !== 0 || drag) return;
    try {
      surface.setPointerCapture(e.pointerId);
    } catch {}
    drag = { id: e.pointerId, x0: e.clientX, s0: s, moved: false, headed: mode === "spring" ? sTarget : null, samples: [] };
    pressT = 0.985;
    kick();
  };
  const onMove = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.abs(e.clientX - drag.x0) < SLOP) return;
      // Catch the word where it is and take it from there.
      drag.moved = true;
      drag.x0 = e.clientX;
      drag.s0 = s;
      sv = 0;
      mode = "drag";
      surface.dataset.dragging = "";
    }
    s = drag.s0 - (e.clientX - drag.x0) / D;
    drag.samples.push({ t: performance.now(), s });
    if (drag.samples.length > 12) drag.samples.shift();
    kick();
  };
  const onUp = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    pressT = 1;
    delete surface.dataset.dragging;
    if (!d.moved) {
      if (e.type === "pointerup") {
        if (d.headed !== null) sTarget = d.headed;
        advance(e.shiftKey ? -1 : 1);
      }
    } else release(e.type === "pointerup" ? speed(d.samples) : 0);
    kick();
  };

  // The trackpad: a sideways swipe scrubs the same way; when it stops
  // coming, the scrub is let go with the speed it had.
  let wheelTimer = 0;
  let wheelSamples = [];
  const onWheel = (e) => {
    if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || drag) return;
    e.preventDefault();
    const px = e.deltaMode === 1 ? e.deltaX * 16 : e.deltaMode === 2 ? e.deltaX * W : e.deltaX;
    if (mode !== "wheel") {
      mode = "wheel";
      sv = 0;
      wheelSamples = [];
    }
    s += px / D;
    wheelSamples.push({ t: performance.now(), s });
    if (wheelSamples.length > 12) wheelSamples.shift();
    clearTimeout(wheelTimer);
    wheelTimer = setTimeout(() => {
      if (mode !== "wheel") return;
      const recent = wheelSamples.filter((q) => wheelSamples[wheelSamples.length - 1].t - q.t < 100);
      const p = recent[0];
      const q = recent[recent.length - 1];
      const v = recent.length > 1 && q.t > p.t ? (q.s - p.s) / ((q.t - p.t) / 1000) : 0;
      release(clamp(v * 0.5, -20, 20));
    }, 110);
    kick();
  };

  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target !== surface && e.target !== document.body) return;
    if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight") {
      e.preventDefault();
      if (e.repeat && e.key !== "ArrowRight") return;
      advance(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      advance(-1);
    }
  };
  surface.addEventListener("pointerdown", onDown);
  surface.addEventListener("pointermove", onMove);
  surface.addEventListener("pointerup", onUp);
  surface.addEventListener("pointercancel", onUp);
  surface.addEventListener("lostpointercapture", onUp);
  surface.addEventListener("wheel", onWheel, { passive: false });
  const keyTarget = embedded ? surface : window;
  keyTarget.addEventListener("keydown", onKey);

  const ro = new ResizeObserver(() => {
    const r = box.getBoundingClientRect();
    if (Math.abs(r.width - W) < 0.5 && Math.abs(r.height - H) < 0.5) return;
    if (!layout()) return;
    // Snap to the settled word at the new size.
    jump(mod(Math.round(sTarget)));
    render();
  });
  ro.observe(box);

  // Dev check: every word pair, both ways, three ways of getting across.
  // A tap (the release spring from rest); a slow scrub that stops every
  // 0.05 of the way and holds; and a flick through several words. Flags any
  // instant two visible glyphs overlap (beyond what either word's own
  // kerning sets), a piece under MIN_PIECE, a glyph still cut while the
  // scrub is held, and a word that is not whole once it has come to rest.
  const check = () => {
    const tol = 0.5 + SLACK * size;
    const flags = [];
    const timing = [];
    const seen = new Set();
    let label = "";
    const flag = (kind, msg) => {
      if (seen.has(label + kind + msg)) return;
      seen.add(label + kind + msg);
      flags.push({ pair: label, t: +clock.toFixed(3), kind, msg });
    };
    const audit = ({ held = false } = {}) => {
      const all = [...glyphs, ...leftovers].filter((g) => g.vis);
      // Two whole neighbours on screen, nearer than SPACE ink to ink.
      const whole = all.filter((g) => g.w >= 1).sort((p, q) => mid(p, p.x + p.dx) - mid(q, q.x + q.dx));
      for (let i = 0; i + 1 < whole.length; i += 1) {
        const [g, h] = [whole[i], whole[i + 1]];
        const short = reqOf(g.ch, h.ch) - (h.x + h.dx - g.x - g.dx);
        if (short > 0.25) flag("graze", `${g.ch}${h.ch} ${((SPACE * size - short) / size).toFixed(3)}em ink to ink`);
      }
      for (const g of all) {
        const wv = g.vis[1] - g.vis[0];
        const whole = g.vis[0] <= inkL(g) + 0.01 && g.vis[1] >= inkR(g) - 0.01;
        if (!whole && wv < MIN_PIECE * size - tol) flag("sliver", `${g.ch} ${(wv / size).toFixed(3)}em`);
        if (whole && outside(g, g.x) && g.vis[1] - g.vis[0] > 0) flag("off page", `${g.ch}(${g.role}) at P=${(s - base).toFixed(2)}`);
        if (!whole && held) flag("held cut", `${g.ch}(${g.role}) at P=${(s - base).toFixed(2)}`);
      }
      for (let i = 0; i < all.length; i += 1) {
        for (let j = i + 1; j < all.length; j += 1) {
          const [g, h] = mid(all[i]) <= mid(all[j]) ? [all[i], all[j]] : [all[j], all[i]];
          const over = g.vis[1] + g.dx - h.vis[0] - h.dx;
          const kern = Math.max(0, -need(g, h));
          if (over > kern + tol && h.vis[1] + h.dx > g.vis[0] + g.dx) flag("overlap", `${g.ch}(${g.role})|${h.ch}(${h.role}) ${(over / size).toFixed(3)}em at P=${(s - base).toFixed(2)}`);
        }
      }
    };
    const restWhole = (k) => {
      const word = WORDS[mod(k)];
      const shown = [...glyphs, ...leftovers].filter((g) => g.w > 0);
      const text = shown.sort((p, q) => p.x - q.x).map((g) => g.ch).join("");
      if (text !== word || shown.some((g) => g.w < 1)) flag("unfinished", `rests as "${text}" for "${word}"`);
    };
    const run = (sec, each) => {
      const n = Math.round(sec / STEP);
      for (let k = 0; k < n; k += 1) {
        step(STEP);
        each?.(k);
      }
    };
    for (let w = 0; w < N; w += 1) {
      for (const dir of [1, -1]) {
        label = `${WORDS[w]}>${WORDS[mod(w + dir)]}`;
        // A tap.
        jump(w);
        const t0 = clock;
        const span = { pair: label, cut: 0, whole: null, rest: null };
        timing.push(span);
        advance(dir);
        run(0.9, () => {
          audit();
          const cut = [...glyphs, ...leftovers].some((g) => g.w > 0 && g.w < 1) || leftovers.length;
          if (cut) {
            span.cut += 1;
            span.whole = null;
          } else if (span.whole === null) span.whole = +(clock - t0).toFixed(3);
          if (span.rest === null && mode === "rest" && glyphs.every((g) => Math.abs(g.x - target(g, s - base)) < 0.5)) span.rest = +(clock - t0).toFixed(3);
        });
        restWhole(w + dir);
        // A slow scrub that stops and holds.
        jump(w);
        mode = "drag";
        for (let q = 1; q <= 20; q += 1) {
          const from = s;
          const to = w + (dir * q) / 20;
          run(0.06, (k) => {
            s = from + (to - from) * Math.min(1, (k + 1) / Math.round(0.06 / STEP));
            audit();
          });
          run(0.3);
          audit({ held: true });
        }
        mode = "rest";
        run(0.6);
        restWhole(w + dir);
      }
    }
    // A flick through the chain, each way.
    for (const v of [14, -14]) {
      label = `flick ${v > 0 ? "on" : "back"}`;
      jump(0);
      release(v);
      const end = sTarget;
      run(2.5, () => audit());
      restWhole(end);
    }
    jump(startAt);
    const spacing = WORDS.map((w, k) => `${w}: ${layouts[k].nudges.join(", ") || "as set"}`);
    const result = { ok: flags.length === 0, size, pairs: N * 2, flags, timing, spacing };
    window.__glyphMorphCheck = result;
    console.log(`glyph-morph check: ${result.ok ? "ok" : `${flags.length} flags`} ${JSON.stringify(result)}`);
    surface.dataset.check = result.ok ? "ok" : "fail";
    return result;
  };

  layout();
  jump(startAt);
  if (runCheck) check();
  else if (holdP !== null) {
    // A still held on the scrub: ?p=0.4 is 0.4 of the way from word w to
    // the next, every spring caught up and every wipe done.
    s = startAt + holdP;
    rebase();
    const P = s - base;
    for (const g of glyphs) {
      g.x = g.anchor ? target(g.anchor.g, P) + g.anchor.off : target(g, P);
      g.v = 0;
    }
    settleVis(P);
  } else if (holdT !== null) {
    // A still of a tap: from word w to w + 1, t seconds in.
    advance(1);
    const n = Math.round(holdT / STEP);
    for (let i = 0; i < n; i += 1) step(STEP);
  }
  render();
  requestAnimationFrame(() => surface.setAttribute("data-ready", ""));

  return {
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      clearTimeout(wheelTimer);
      ro.disconnect();
      surface.removeEventListener("wheel", onWheel);
      keyTarget.removeEventListener("keydown", onKey);
      surface.remove();
    },
  };
}
