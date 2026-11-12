// One word, morphing letter by letter into the next. Each word is laid out
// once by the browser (real kerning, tracking from the house law), and every
// glyph is then set alone at the x the browser gave it. A glyph two words
// share is the same element in both: it slides on a spring from its place in
// the old word to its place in the new one.
//
// Glyphs never cut each other. Two glyphs' visible boxes never overlap, and a
// glyph is either whole, gone, or shown as a piece at least MIN_PIECE wide.
//
// Exit: a glyph only in the old word stays whole, at full ink, where it
// stands. When a live glyph's ink box is about to reach it (looked ahead on
// the springs), it is wiped away inside its own box in EXIT_WIPE, cut from
// the side the word closes from, so it is gone before the two could touch.
//
// Entry: a glyph only in the new word rides bound to the kept neighbour it
// grows from, at its place in the new word, so it never lands on the moving
// word. It shows nothing until the gap it
// needs has opened on the side it grows from; then it wipes in out of that
// neighbour's side, only inside the gap that has opened and inside its own ink
// box, and is whole before the word settles.

import { isDevView } from "@/lib/viewMode";

const WORDS = ["Help", "Hello", "Yellow", "Yes", "Yesterday", "Birthday", "Blackbird", "Bird", "Here", "There", "Helter"];

// Spring for shared glyphs, in Motion's terms: settles visually in ~0.5s
// with a hair of overshoot. Mass 1.
const VISUAL = 0.52;
const BOUNCE = 0.12;
const K = (2 * Math.PI / VISUAL) ** 2;
const C = 2 * (1 - BOUNCE) * Math.sqrt(K);
// The press: a stiffer, fully damped spring on the whole word.
const K_PRESS = 900;
const C_PRESS = 2 * Math.sqrt(K_PRESS);

const ENTER = { delay: 0.04, dur: 0.15, stagger: 0.035 };
const EXIT_WIPE = 0.08; // s: a leaving glyph's wipe, finished before contact
const EXIT_BEAT = 0.04; // s: between leaving glyphs that go in one wave
const EXIT_LATE = 0.42; // s: a leaving glyph nothing closes on goes by then
const GUTTER = 0.04; // em of ground kept between any two visible glyphs
const MIN_PIECE = 0.25; // em: no glyph is shown as a piece narrower than this
const PAD = 0.03; // em of slack around a glyph's ink, so clip edges stay clean
const STEP = 1 / 240;
const AUTO_FIRST = 1.4;
const AUTO_EVERY = 2.2;
const AUTO_RESUME = 7;

const lawPx = (s) => -0.043 * (s - 12);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const easeOut = (t) => 1 - (1 - t) ** 3;
const easeIn = (t) => t * t;

export async function createGlyphMorph(stage, { embedded = false, onLive = () => {} } = {}) {
  const params = new URLSearchParams(window.location.search);
  const holdT = params.has("t") ? clamp(parseFloat(params.get("t")) || 0, 0, 5) : null;
  const startAt = clamp(parseInt(params.get("w") || "0", 10) || 0, 0, WORDS.length - 1);
  const runCheck = params.has("check") && isDevView();
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const surface = document.createElement("div");
  surface.className = "gm-surface";
  surface.setAttribute("role", "button");
  surface.setAttribute("aria-label", "Next word");
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
  let index = startAt;
  let glyphs = []; // the current word, in order
  let dying = [];
  let clock = 0;
  let since = 0; // clock at the last change of word
  let raf = 0;
  let last = 0;
  let acc = 0;
  let destroyed = false;
  let press = 1;
  let pressV = 0;
  let pressT = 1;
  let autoTimer = 0;
  let originY = 0;
  let inkCtx = null;
  let inkCache = new Map();

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

  const setMeter = (s) => {
    meter.style.fontSize = `${s}px`;
    meter.style.lineHeight = `${Math.round(s)}px`;
    const track = lawPx(s);
    meter.style.letterSpacing = s >= 20 ? `${(track / s).toFixed(4)}em` : `${track.toFixed(2)}px`;
    return track;
  };

  const layout = () => {
    const r = box.getBoundingClientRect();
    W = r.width;
    H = r.height;
    if (!W || !H) return false;
    // Fit the widest word: width(s) = adv100 * s / 100 + law(s) * (n - 1).
    setMeter(100);
    meter.style.letterSpacing = "0";
    const side = Math.max(24, W * (W < 640 ? 0.07 : 0.1));
    const room = W - side * 2;
    let fit = Infinity;
    for (const w of WORDS) {
      const { end } = measureWord(w);
      const n = w.length - 1;
      fit = Math.min(fit, (room - 0.516 * n) / (end / 100 - 0.043 * n));
    }
    size = Math.round(clamp(Math.min(fit, H * 0.42, 340), 24, 340));
    const track = setMeter(size);
    // Baseline: a zero-size inline-block sits on it.
    meter.textContent = "H";
    const probe = document.createElement("span");
    probe.className = "gm-probe";
    meter.append(probe);
    const baseOff = probe.getBoundingClientRect().top - meter.getBoundingClientRect().top;
    inkCtx = document.createElement("canvas").getContext("2d");
    inkCtx.font = `600 ${size}px ${getComputedStyle(meter).fontFamily}`;
    inkCache = new Map();
    const cap = inkCtx.measureText("H").actualBoundingBoxAscent || size * 0.71;
    // Centre the cap band, nudged a touch above true centre.
    const baseline = Math.round(H / 2 + cap / 2 - H * 0.015);
    baseTop = baseline - baseOff;
    originY = baseline - cap / 2;
    layouts = WORDS.map((w) => {
      const { lefts, end } = measureWord(w);
      const width = end - track; // drop the trailing tracking after the last glyph
      const x0 = (W - width) / 2;
      return { x: lefts.map((l) => x0 + l) };
    });
    meter.textContent = "";
    for (const g of [...glyphs, ...dying]) styleGlyph(g);
    wordEl.style.transformOrigin = `${W / 2}px ${originY}px`;
    return true;
  };

  // Where a glyph's upright strokes are: runs of columns, from its ink's
  // left edge, holding an unbroken stretch of ink at least half as tall as
  // the glyph's longest one.
  // A cut never lands inside one, so no stem or bowl side is left as a
  // hairline beside a clean edge.
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
    // Each column's longest unbroken stretch of ink.
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
        // In ink coordinates, widened a pixel each side for the soft edge.
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
      m = { l, r, w: r - l, runs: strokeRuns(ch, l, r) };
      inkCache.set(ch, m);
    }
    return m;
  };

  const styleGlyph = (g) => {
    g.el.style.fontSize = `${size}px`;
    g.el.style.lineHeight = `${Math.round(size)}px`;
    g.el.style.top = `${baseTop}px`;
    g.ink = inkOf(g.ch);
    g.drawn = "";
  };

  // mode: "live" (whole), "enter" (waiting for its gap, then wiping in),
  // "dying" (whole until its exit wipe starts, then gone).
  const makeGlyph = (ch, x) => {
    const el = document.createElement("span");
    el.className = "gm-glyph";
    el.setAttribute("aria-hidden", "true");
    el.textContent = ch;
    wordEl.append(el);
    const g = { ch, el, x, v: 0, tx: x, anchor: null, mode: "live", side: -1, at: 0, t0: null, exit: null, vis: null, clip: null, drawn: "" };
    styleGlyph(g);
    return g;
  };

  const inkL = (g, x = g.x) => x + g.ink.l;
  const inkR = (g, x = g.x) => x + g.ink.r;

  // Ground kept between two glyphs' ink boxes: the gutter, but neighbours in
  // the new word only need what the settled word itself leaves them.
  const gutBetween = (left, right) => {
    const i = glyphs.indexOf(left);
    if (i < 0 || glyphs[i + 1] !== right) return GUTTER * size;
    return Math.min(0, inkL(right, right.tx) - inkR(left, left.tx));
  };

  // Which glyphs of the current word carry over: the longest run of letters
  // the two words share in order (so no glyph ever slides through another),
  // and among equally long runs the one that moves the glyphs least.
  const match = (from, word, xs) => {
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
          const take = { c: t.c + 1, d: t.d + Math.abs(from[i].tx - xs[j]) };
          if (take.c > pick.c || (take.c === pick.c && take.d < pick.d)) pick = { ...take, take: true };
        }
        best[i][j] = pick.take && pick !== best[i + 1][j] && pick !== best[i][j + 1] ? pick : { c: pick.c, d: pick.d };
      }
    }
    const pairs = new Map(); // new index -> old glyph
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

  const settled = (h) => !h || (h.x === h.tx && h.v === 0 && !h.anchor);

  // A riding glyph's place: its offset from its anchor's target, carried by
  // where that anchor is.
  const placeAt = (g, xa, xb) => {
    const { a, b, w, oa, ob } = g.anchor;
    const pa = a ? xa + oa : 0;
    const pb = b ? xb + ob : 0;
    return a && b ? pa + (pb - pa) * w : a ? pa : pb;
  };
  const place = (g) => {
    const { a, b, w } = g.anchor;
    g.x = placeAt(g, a ? a.x : 0, b ? b.x : 0);
    g.v = a && b ? a.v + (b.v - a.v) * w : (a || b).v;
  };

  const show = (i, { instant = false } = {}) => {
    index = (i + WORDS.length) % WORDS.length;
    since = clock;
    const word = WORDS[index];
    const xs = layouts[index].x;
    const prev = glyphs;
    // Remember who stood beside whom, and how close the font set them.
    prev.forEach((g, k) => {
      const h = prev[k + 1];
      g.was = h ? { right: h, kern: Math.max(0, inkR(g, g.tx) - inkL(h, h.tx)) } : null;
    });
    const pairs = instant ? new Map() : match(prev, word, xs);
    const kept = new Set(pairs.values());
    const sprung = []; // indices in the new word that move on their own spring
    const next = [...word].map((ch, j) => {
      let g = pairs.get(j);
      if (!g && !instant) {
        // A glyph still whole on its way out, close by, comes back instead.
        let near = -1;
        let nd = size * 0.35;
        dying.forEach((o, k) => {
          const d = Math.abs(o.x - xs[j]);
          if (o.ch === ch && !o.exit && d < nd) {
            near = k;
            nd = d;
          }
        });
        if (near >= 0) {
          [g] = dying.splice(near, 1);
          g.mode = "live";
        }
      }
      if (g) {
        g.tx = xs[j];
        g.anchor = null;
        if (instant || reduced) {
          g.x = g.tx;
          g.v = 0;
        }
        sprung.push(j);
      } else {
        g = makeGlyph(ch, xs[j]);
        if (!instant) {
          g.mode = "enter";
          g.t0 = null;
        }
      }
      return g;
    });
    glyphs = next;

    // New glyphs ride the kept neighbour they grow from, at their place in
    // the new word, so each shows up already set beside it. A run of them
    // between two kept glyphs fills the opening gap from both sides toward a
    // seam; until the gap is fully open, the glyphs either side of the seam
    // are the ones kept waiting, so the seam goes where they are wide enough
    // to show a piece, as near the middle of the run as that allows.
    if (!instant) {
      const ride = (j, a, b, fromLeft, d) => {
        const g = next[j];
        g.side = fromLeft ? -1 : 1;
        g.anchor = fromLeft ? { a, b: null, w: 0, oa: xs[j] - a.tx, ob: 0 } : { a: null, b, w: 1, oa: 0, ob: xs[j] - b.tx };
        place(g);
        g.at = clock + ENTER.delay + ENTER.stagger * (d - 1);
      };
      const wide = 0.4 * size;
      const bounds2 = [-1, ...sprung, next.length];
      for (let q = 0; q + 1 < bounds2.length; q += 1) {
        const L = bounds2[q];
        const R = bounds2[q + 1];
        const n = R - L - 1;
        if (n <= 0) continue;
        const a = L >= 0 ? next[L] : null;
        const b = R < next.length ? next[R] : null;
        if (!a && !b) {
          for (let j = L + 1; j < R; j += 1) {
            next[j].side = -1;
            next[j].at = clock + ENTER.delay + ENTER.stagger * j;
          }
          continue;
        }
        let split = a ? n : 0; // how many grow from the left
        if (a && b) {
          let best = -Infinity;
          for (let k = 0; k <= n; k += 1) {
            const edge = [k > 0 ? next[L + k] : null, k < n ? next[L + k + 1] : null].filter(Boolean);
            const score = Math.min(...edge.map((g) => Math.min(g.ink.w, wide))) * 100 - Math.abs(k - n / 2) - (k < n / 2 ? 0.1 : 0);
            if (score > best) [best, split] = [score, k];
          }
        }
        for (let j = L + 1; j < R; j += 1) {
          const k = j - L - 1;
          if (k < split) ride(j, a, b, true, j - L);
          else ride(j, a, b, false, R - j);
        }
      }
    }

    for (const g of prev) {
      if (kept.has(g) || next.includes(g)) continue;
      if (instant || g.mode === "enter") g.el.remove();
      else {
        // Stays whole, at full ink, where it stands.
        g.mode = "dying";
        g.anchor = null;
        g.tx = g.x;
        g.v = 0;
        g.exit = null;
        dying.push(g);
      }
    }
    update();
    onLive(word);
    kick();
  };

  // Where every live glyph will be over the next `horizon` seconds, run
  // ahead on copies of the springs: one x per step.
  const lookahead = (horizon) => {
    const st = new Map();
    for (const g of glyphs) st.set(g, { x: g.x, v: g.v, path: [g.x] });
    const n = Math.ceil(horizon / STEP);
    for (let k = 0; k < n; k += 1) {
      for (const g of glyphs) {
        if (g.anchor) continue;
        const s = st.get(g);
        s.v += (-K * (s.x - g.tx) - C * s.v) * STEP;
        s.x += s.v * STEP;
      }
      for (const g of glyphs) {
        const s = st.get(g);
        if (g.anchor) {
          const { a, b } = g.anchor;
          s.x = placeAt(g, a ? st.get(a).x : 0, b ? st.get(b).x : 0);
        }
        s.path.push(s.x);
      }
    }
    return st;
  };

  const centre = (g) => g.x + (g.ink.l + g.ink.r) / 2;

  // Start a leaving glyph's wipe once a live glyph (or a new one whose turn
  // has come) is about to close on it: within EXIT_WIPE its ink box will come
  // nearer than the gutter. The wipe is timed to be gone before the boxes
  // could touch, and cuts from the side the word closes from.
  const triggerExits = () => {
    const waiting = dying.filter((g) => !g.exit);
    if (!waiting.length) return;
    const ahead = lookahead(EXIT_WIPE);
    const gut = GUTTER * size;
    const calm = glyphs.every((h) => settled(h));
    for (const d of waiting) {
      let best = null;
      for (const h of glyphs) {
        if (h.mode === "enter" && clock < h.at) continue;
        const right = centre(h) >= centre(d);
        const gapAt = (x) => (right ? inkL(h, x) - inkR(d) : inkL(d) - inkR(h, x));
        const { path } = ahead.get(h);
        if (h.mode === "enter") {
          // A new glyph whose turn has come claims its ground: it shows
          // nothing there until this one is gone, so the wipe takes its time.
          const k = path.findIndex((x) => gapAt(x) < gut);
          if (k >= 0 && (!best || k < best.k)) best = { k, side: right ? 1 : -1, dur: EXIT_WIPE };
          continue;
        }
        // A live glyph: only one coming nearer than it already is counts.
        const now = gapAt(h.x);
        const near = Math.min(gut, now) - 0.25;
        const touch = Math.min(0, now) - 0.25;
        const k = path.findIndex((x) => gapAt(x) < near);
        if (k < 0 || (best && k >= best.k)) continue;
        let tc = path.findIndex((x) => gapAt(x) < touch);
        if (tc < 0) tc = path.length;
        best = { k, side: right ? 1 : -1, dur: clamp(tc * STEP, 0, EXIT_WIPE) };
      }
      if (!best) {
        // Nothing closes on it. It goes in the wave of its leaving neighbour
        // on the word's side, one beat after that one starts; with no such
        // neighbour, once the word is calm.
        let nd = Infinity;
        let side = 1;
        for (const h of glyphs) {
          const dd = Math.abs(centre(h) - centre(d));
          if (dd < nd) [nd, side] = [dd, centre(h) >= centre(d) ? 1 : -1];
        }
        const between = dying.filter((o) => o !== d && (centre(o) - centre(d)) * side > 0 && Math.abs(centre(o) - centre(d)) < nd);
        const lead = between.sort((p, q) => Math.abs(centre(p) - centre(d)) - Math.abs(centre(q) - centre(d)))[0];
        if (lead ? lead.exit && clock - lead.exit.t0 >= EXIT_BEAT : calm || clock - since > EXIT_LATE) best = { side, dur: EXIT_WIPE };
      }
      if (best) d.exit = { side: best.side, t0: clock, dur: best.dur };
    }
  };

  // A glyph's visible span, in stage px, as a closed piece of its ink box:
  // null when hidden. Pieces under MIN_PIECE are not shown.
  const piece = (g, A, B) => {
    const minW = Math.min(MIN_PIECE * size, g.ink.w);
    const o = inkL(g);
    let a = A;
    let b = B;
    // Pull a cut out of any upright stroke it would split, onto the hidden
    // side, so the stroke shows whole or not at all.
    for (const [r0, r1] of g.ink.runs) {
      if (a > o + 0.01 && a > o + r0 && a < o + r1) a = o + r1;
      if (b < inkR(g) - 0.01 && b > o + r0 && b < o + r1) b = o + r0;
    }
    if (b - a < minW - 0.01) return null;
    return [a, b];
  };

  const visDying = (g) => {
    if (!g.exit) return [inkL(g), inkR(g)];
    if (g.exit.dur < 2 * STEP) return null;
    const p = clamp((clock - g.exit.t0) / g.exit.dur, 0, 1);
    if (p >= 1) return null;
    if (g.ink.w < MIN_PIECE * size) return p < 0.5 ? [inkL(g), inkR(g)] : null;
    const e = easeIn(p) * g.ink.w;
    return g.exit.side > 0 ? piece(g, inkL(g), inkR(g) - e) : piece(g, inkL(g) + e, inkR(g));
  };

  // The ground an entering glyph may take: its ink box, less every other
  // glyph's box and the ground kept around it.
  const bounds = (g) => {
    let lb = -Infinity;
    let rb = Infinity;
    const i = glyphs.indexOf(g);
    glyphs.forEach((h, k) => {
      if (h === g) return;
      if (k < i) lb = Math.max(lb, inkR(h) + gutBetween(h, g));
      else rb = Math.min(rb, inkL(h) - gutBetween(g, h));
    });
    // A leaving glyph keeps its whole box until it is gone, so a new one
    // never grows in beside a half-wiped one.
    for (const d of dying) {
      if (!d.vis) continue;
      if (centre(d) < centre(g)) lb = Math.max(lb, inkR(d) + GUTTER * size);
      else rb = Math.min(rb, inkL(d) - GUTTER * size);
    }
    return [lb, rb];
  };

  const visEnter = (g) => {
    const gl = inkL(g);
    const gr = inkR(g);
    const w = g.ink.w;
    const minW = Math.min(MIN_PIECE * size, w);
    const [lb, rb] = bounds(g);
    if (g.t0 === null) {
      if (clock < g.at) return null;
      // Open the gap first: the side it grows from must be clear, with room
      // for a first piece.
      const open = g.side < 0 ? lb <= gl + 0.01 && Math.min(rb, gr) - gl >= minW : rb >= gr - 0.01 && gr - Math.max(lb, gl) >= minW;
      if (!open) return null;
      g.t0 = clock;
    }
    const p = easeOut(clamp((clock - g.t0) / ENTER.dur, 0, 1));
    const reach = minW + (w - minW) * p;
    const A = Math.max(gl, lb, g.side > 0 ? gr - reach : -Infinity);
    const B = Math.min(gr, rb, g.side < 0 ? gl + reach : Infinity);
    // Whole once the wipe is done and no bound cuts it by a visible amount.
    if (p >= 1 && A <= gl + 0.5 && B >= gr - 0.5) {
      g.mode = "live";
      return [gl, gr];
    }
    return piece(g, A, B);
  };

  // Settle every glyph's visible span for this instant.
  const update = () => {
    triggerExits();
    for (const g of dying) g.vis = visDying(g);
    for (const g of glyphs) {
      if (g.mode === "enter") g.vis = visEnter(g);
      else g.vis = [inkL(g), inkR(g)];
    }
  };

  const step = (dt) => {
    clock += dt;
    let busy = false;
    for (const g of glyphs) {
      if (g.anchor) continue;
      const a2 = -K * (g.x - g.tx) - C * g.v;
      g.v += a2 * dt;
      g.x += g.v * dt;
      if (Math.abs(g.x - g.tx) < 0.01 && Math.abs(g.v) < 0.01) {
        g.x = g.tx;
        g.v = 0;
      } else busy = true;
    }
    for (const g of glyphs) {
      if (!g.anchor) continue;
      busy = true;
      if (settled(g.anchor.a) && settled(g.anchor.b)) {
        g.anchor = null;
        g.x = g.tx;
        g.v = 0;
      } else place(g);
    }
    update();
    dying = dying.filter((g) => {
      if (g.vis || !g.exit || clock - g.exit.t0 < g.exit.dur) return true;
      g.el.remove();
      return false;
    });
    if (dying.length || glyphs.some((g) => g.mode === "enter")) busy = true;
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
    const s = !v ? "hidden" : full ? `${g.x.toFixed(2)}|full` : `${g.x.toFixed(2)}|${a.toFixed(1)}|${b.toFixed(1)}`;
    if (s === g.drawn) return;
    g.drawn = s;
    if (!v) {
      g.el.style.visibility = "hidden";
      return;
    }
    g.el.style.visibility = "";
    g.el.style.transform = `translate3d(${g.x.toFixed(2)}px,0,0)`;
    if (full) g.el.style.clipPath = "none";
    else {
      const t = (-0.4 * size).toFixed(1);
      const bt = (1.4 * size).toFixed(1);
      g.el.style.clipPath = `polygon(${a.toFixed(1)}px ${t}px,${b.toFixed(1)}px ${t}px,${b.toFixed(1)}px ${bt}px,${a.toFixed(1)}px ${bt}px)`;
    }
  };

  const render = () => {
    for (const g of glyphs) draw(g);
    for (const g of dying) draw(g);
    wordEl.style.transform = press === 1 ? "" : `scale(${press.toFixed(4)})`;
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
    if (busy) raf = requestAnimationFrame(frame);
  };

  const kick = () => {
    if (raf || destroyed || holdT !== null || runCheck) return;
    last = performance.now();
    acc = 0;
    raf = requestAnimationFrame(frame);
  };

  const schedule = (sec) => {
    clearTimeout(autoTimer);
    if (holdT !== null || runCheck || destroyed) return;
    autoTimer = setTimeout(() => {
      if (document.hidden) return schedule(AUTO_EVERY);
      show(index + 1);
      schedule(AUTO_EVERY);
    }, sec * 1000);
  };

  const advance = (dir) => {
    show(index + dir);
    schedule(AUTO_RESUME);
  };

  const onDown = (e) => {
    if (e.button !== 0) return;
    pressT = 0.985;
    kick();
  };
  const onUp = (e) => {
    if (pressT === 1) return;
    pressT = 1;
    kick();
    if (e.type === "pointerup") advance(e.shiftKey ? -1 : 1);
  };
  const onKey = (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target !== surface && e.target !== document.body) return;
    if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight") {
      e.preventDefault();
      if (e.repeat) return;
      advance(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      advance(-1);
    }
  };
  surface.addEventListener("pointerdown", onDown);
  surface.addEventListener("pointerup", onUp);
  surface.addEventListener("pointerleave", onUp);
  surface.addEventListener("pointercancel", onUp);
  const keyTarget = embedded ? surface : window;
  keyTarget.addEventListener("keydown", onKey);

  const reset = (w) => {
    for (const g of [...glyphs, ...dying]) g.el.remove();
    glyphs = [];
    dying = [];
    show(w, { instant: true });
  };

  const ro = new ResizeObserver(() => {
    const r = box.getBoundingClientRect();
    if (Math.abs(r.width - W) < 0.5 && Math.abs(r.height - H) < 0.5) return;
    if (!layout()) return;
    // Snap to the settled word at the new size.
    reset(index);
    render();
  });
  ro.observe(box);

  // Dev check: sweep every word pair, both ways, through the first 0.6s,
  // and flag any instant where two visible glyphs overlap (beyond what the
  // settled word's own kerning sets), where a glyph shows as a piece under
  // MIN_PIECE, or where a glyph is still cut once the word has settled.
  const check = () => {
    const tol = 0.5;
    const flags = [];
    const pairs = [];
    const timing = [];
    for (let w = 0; w < WORDS.length; w += 1) pairs.push([w, 1], [w, -1]);
    for (const [w, dir] of pairs) {
      reset(w);
      const label = `${WORDS[w]}>${WORDS[(w + dir + WORDS.length) % WORDS.length]}`;
      show(w + dir);
      const n = Math.round(0.6 / STEP);
      const seen = new Set();
      const span = { pair: label, cut: 0, whole: null, rest: null };
      timing.push(span);
      for (let k = 0; k <= n; k += 1) {
        if (k) step(STEP);
        const t = +(clock - since).toFixed(3);
        const all = [...glyphs, ...dying].filter((g) => g.vis);
        const flag = (kind, msg) => {
          if (seen.has(kind + msg)) return;
          seen.add(kind + msg);
          flags.push({ pair: label, t, kind, msg });
        };
        for (const g of all) {
          const wv = g.vis[1] - g.vis[0];
          const whole = g.vis[0] <= inkL(g) + 0.01 && g.vis[1] >= inkR(g) - 0.01;
          if (!whole && wv < MIN_PIECE * size - tol) flag("sliver", `${g.ch} ${(wv / size).toFixed(3)}em`);
        }
        for (let i = 0; i < all.length; i += 1) {
          for (let j = i + 1; j < all.length; j += 1) {
            const [g, h] = centre(all[i]) <= centre(all[j]) ? [all[i], all[j]] : [all[j], all[i]];
            const over = g.vis[1] - h.vis[0];
            const gi = glyphs.indexOf(g);
            let kern = gi >= 0 && glyphs[gi + 1] === h ? Math.max(0, inkR(g, g.tx) - inkL(h, h.tx)) : 0;
            if (g.was && g.was.right === h) kern = Math.max(kern, g.was.kern);
            if (over > kern + tol && h.vis[1] > g.vis[0]) flag("overlap", `${g.ch}(${g.mode})|${h.ch}(${h.mode}) ${(over / size).toFixed(3)}em`);
          }
        }
        const cut = all.some((g) => g.vis[0] > inkL(g) + 0.01 || g.vis[1] < inkR(g) - 0.01) || glyphs.some((g) => !g.vis) || dying.length;
        if (cut) {
          span.cut += 1;
          span.whole = null;
        } else if (span.whole === null) span.whole = t;
        // At rest to the eye: every glyph within half a pixel of home.
        const still = glyphs.every((g) => Math.abs(g.x - g.tx) < 0.5 && Math.abs(g.v) < size * 0.05);
        if (span.rest === null && still) span.rest = t;
        if (still || k === n) {
          for (const g of glyphs) if (g.mode === "enter") flag("unfinished", `${g.ch} still entering at rest (${g.t0 === null ? "waiting" : "wiping"})`);
          for (const g of dying) flag("unfinished", `${g.ch} still leaving at rest (${g.exit ? "wiping" : "waiting"})`);
        }
      }
    }
    reset(startAt);
    const result = { ok: flags.length === 0, size, pairs: pairs.length, flags, timing };
    window.__glyphMorphCheck = result;
    console.log(`glyph-morph check: ${result.ok ? "ok" : `${flags.length} flags`} ${JSON.stringify(result)}`);
    surface.dataset.check = result.ok ? "ok" : "fail";
    return result;
  };

  layout();
  show(index, { instant: true });
  if (runCheck) check();
  else if (holdT !== null) {
    // A still of the morph: from word w to w + 1, t seconds in.
    show(index + 1);
    const n = Math.round(holdT / STEP);
    for (let i = 0; i < n; i += 1) step(STEP);
  }
  render();
  requestAnimationFrame(() => surface.setAttribute("data-ready", ""));
  schedule(AUTO_FIRST);

  return {
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      clearTimeout(autoTimer);
      ro.disconnect();
      keyTarget.removeEventListener("keydown", onKey);
      surface.remove();
    },
  };
}
