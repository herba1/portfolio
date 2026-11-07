import { createStage, clamp } from "../_kit/stage";

// A designing programme, after Karl Gerstner (1964): one logotype set
// across a ruled grid, every cell the same word with its parameters run
// systematically. Two rows of Gerstner's morphological box are live at a
// time, one along the columns and one along the rows; every other row of
// the box rests at its default.
//
// Dragging scrubs through the box: horizontal travel re-maps the column
// variable, vertical travel the row variable. Each cell is a spring onto a
// delayed copy of the target, the delay growing with its distance from the
// hand, so a re-map rolls across the grid as a wave and every cell
// interpolates its parameters rather than crossfading. A click promotes a
// cell: that variant is pasted into the sheet as a full-width band, its
// edges stepping out along the rules hairline by hairline, a column and a
// row at a time, so the band keeps the word's proportion and the logotype is
// re-set to fill it at every step; the cells it reaches give way, re-set in
// what is left of them. It holds, and goes back.
//
// The cells take their proportion from the word itself: the bold cut's
// advance against its ascender plus the rule allowance, so at its default
// size every variant sits flush across its cell with a small, equal pad, the
// way Gerstner's typograms are set edge to edge. The size axis runs past 1
// and crops at the cell, rather than shrinking the word into blank ground.
//
// Type follows the house law at every rendered size, including every size
// passed through while a cell grows: tracking = -0.043 x (size - 12) px.
// The law is calibrated for text; pushed out to a display size the heavy
// cuts close up until the tail of the a runs into the s. So the law has a
// floor: tracking never closes the word's tightest pair below a hairline of
// clearance (CLEAR, in em), measured from the glyphs' own ink at each
// weight. At text sizes the law is always looser and wins.
// Resting weights are read from the --font-weight-* ladder tokens.

const FAMILY = "ProgrammeGeist";
const WORD = "raster";
const INK = "#0d0d0c";
const GROUND = "#f5f4f0";
const RED = "#d9261c";
const lawPx = (s) => -0.043 * (s - 12);
const CLEAR = 0.016; // em, the least ink clearance between neighbouring letters

const OMEGA = 12; // cell spring
const ZETA = 0.86; // a touch under critical: one soft settle, no bounce
const DELAY = 0.055; // seconds of wave lag per cell of distance
const STEP_T = 0.34; // seconds the band takes per hairline it crosses
const STEP_MOVE = 0.62; // share of each step spent moving; the rest it rests on the rule
const HOLD = 2.2; // seconds a promoted cell is held before it goes back

let fontPromise = null;
function loadFont() {
  if (!fontPromise) {
    const face = new FontFace(FAMILY, "url(/fonts/Geist-Variable.woff2)", { weight: "100 900", style: "normal" });
    fontPromise = face.load().then((f) => {
      document.fonts.add(f);
      return f;
    });
  }
  return fontPromise;
}

// The weight ladder, from the site's tokens. Only these values are ever
// rested on; anything in between is a cell in motion.
function readLadder() {
  const cs = getComputedStyle(document.documentElement);
  const fallback = {
    light: 300,
    normal: 400,
    meta: 440,
    "body-sm": 490,
    medium: 500,
    caption: 520,
    emphasis: 540,
    strong: 590,
    semibold: 600,
    bold: 700,
  };
  const out = {};
  for (const k of Object.keys(fallback)) {
    const v = parseFloat(cs.getPropertyValue(`--font-weight-${k}`));
    out[k] = Number.isFinite(v) ? v : fallback[k];
  }
  return out;
}

const lin = (a, b) => (n) => Array.from({ length: n }, (_, i) => a + ((b - a) * i) / Math.max(1, n - 1));
// n values spread evenly across a list, ends included.
const spread = (arr, n) => Array.from({ length: n }, (_, i) => arr[Math.round((i * (arr.length - 1)) / Math.max(1, n - 1))]);
// n even steps from the first to the last of a sorted list, each taken to
// the nearest value not already used, so a long axis keeps its steps apart.
// An axis longer than the list repeats rungs in order instead.
const snapSteps = (arr, n) => {
  if (n >= arr.length) return spread(arr, n);
  const used = new Set();
  return lin(arr[0], arr[arr.length - 1])(n).map((t) => {
    let pick = arr[0];
    let d = Infinity;
    for (const v of arr) {
      if (!used.has(v) && Math.abs(v - t) < d) {
        d = Math.abs(v - t);
        pick = v;
      }
    }
    used.add(pick);
    return pick;
  });
};

const RULE_GAP = 0.1; // em, baseline to rule
const RULE_TH = 0.16; // em, rule thickness
const RULE_K = RULE_GAP + RULE_TH;
const PAD = 0.1; // pad on every side, as a fraction of cell height
// A ruled word keeps its rule well clear of the cell's bottom hairline, so
// the two never stack into a hairline, a sliver of ground and a bar. The
// clearance opens with the first trace of the rule, while it is still
// thinner than the hairline itself.
const RULE_CLEAR = 0.22; // fraction of cell height, rule to bottom hairline
const RULE_OPEN = 0.15; // rule amount by which the full clearance is reached

export async function createProgramme(host, { embedded = false } = {}) {
  await loadFont();
  const stage = createStage(host, { dpr: 2 });
  const { ctx, canvas } = stage;
  canvas.style.cursor = "grab";

  const L = readLadder();
  const chars = [...WORD];
  const nL = chars.length;

  // The morphological box. Order matters: a drag passes through
  // neighbours, so each row of the box hands over to the next.
  const VARS = [
    {
      key: "weight",
      def: L.medium,
      lo: L.light,
      hi: L.bold,
      // Five main rungs for a short axis; a long one walks the whole
      // ladder, so every resting weight is still a token.
      steps: (n) =>
        n <= 5
          ? spread([L.light, L.normal, L.medium, L.semibold, L.bold], n)
          : snapSteps([...new Set([L.light, L.normal, L.meta, L["body-sm"], L.medium, L.caption, L.emphasis, L.strong, L.semibold, L.bold])].sort((a, b) => a - b), n),
    },
    // 1 is flush across the cell; past it the word crops at the cell edge.
    { key: "size", def: 1, lo: 1, hi: 2, steps: lin(1, 1.9) },
    { key: "slope", def: 0, lo: 0, hi: 14, steps: lin(0, 14) },
    { key: "rule", def: 0, lo: 0, hi: 1, steps: lin(0, 1) },
    { key: "reversal", def: 0, lo: 0, hi: 1, steps: lin(0, 1) },
    // Red runs in whole letters at rest.
    { key: "red", def: 0, lo: 0, hi: 1, steps: (n) => lin(0, 1)(n).map((v) => Math.round(v * nL) / nL) },
    { key: "align", def: 0, lo: 0, hi: 1, steps: lin(0, 1) },
  ];
  const V = VARS.length;
  const idx = (name, fb) => {
    const i = VARS.findIndex((v) => v.key === name);
    return i < 0 ? fb : i;
  };
  const wrap = (a) => ((a % V) + V) % V;
  const circ = (a, k) => {
    const d = Math.abs(wrap(a) - k);
    return Math.min(d, V - d);
  };

  // ── Metrics, per integer weight, at a reference size ──────────────
  const REF = 200;
  const mctx = document.createElement("canvas").getContext("2d");
  mctx.fontKerning = "normal";
  const fontAt = (w, s) => `${w} ${s}px ${FAMILY}`;
  const mcache = new Map();
  // Each letter's origin, carrying the font's own kerning, at the context's
  // current font: the run up to and including the letter, less the letter's
  // own advance. (The run up to the letter alone would leave out the kern
  // into it and hand it to the next letter instead: Geist kerns r to a
  // hard, and the a would slide into the s.) The last entry is the advance
  // of the whole word.
  const origins = (c) => {
    const o = [];
    for (let i = 0; i < nL; i += 1) o.push(c.measureText(WORD.slice(0, i + 1)).width - c.measureText(chars[i]).width);
    o.push(c.measureText(WORD).width);
    return o;
  };
  // The word's tightest pair at zero tracking: per scanline, the ink of
  // each letter set at its kerned origin, and the least gap between one
  // letter's right edge and the next one's left, in em. Measured on a
  // coarse weight grid and interpolated, since a weight in motion passes
  // through every integer.
  const INK_REF = 240;
  const INK_STEP = 20;
  const inkCanvas = document.createElement("canvas");
  const ictx = inkCanvas.getContext("2d", { willReadFrequently: true });
  const gcache = new Map();
  const inkGapAt = (w) => {
    let g = gcache.get(w);
    if (g !== undefined) return g;
    const S = INK_REF;
    const ox = Math.ceil(S * 0.3);
    const cw = Math.ceil(S * 1.3);
    const chh = Math.ceil(S * 1.4);
    const base = Math.ceil(S * 1.05);
    inkCanvas.width = cw;
    inkCanvas.height = chh;
    ictx.font = fontAt(w, S);
    ictx.fontKerning = "normal";
    ictx.textBaseline = "alphabetic";
    const prefix = origins(ictx);
    // Per letter: leftmost and rightmost ink of each row, from its origin.
    const prof = chars.map((ch) => {
      ictx.clearRect(0, 0, cw, chh);
      ictx.fillStyle = "#000";
      ictx.fillText(ch, ox, base);
      const d = ictx.getImageData(0, 0, cw, chh).data;
      const lo = new Float32Array(chh).fill(NaN);
      const hi = new Float32Array(chh).fill(NaN);
      for (let y = 0; y < chh; y += 1) {
        const row = y * cw * 4 + 3;
        for (let x = 0; x < cw; x += 1) {
          if (d[row + x * 4] > 96) {
            lo[y] = x - ox;
            break;
          }
        }
        for (let x = cw - 1; x >= 0; x -= 1) {
          if (d[row + x * 4] > 96) {
            hi[y] = x - ox;
            break;
          }
        }
      }
      return { lo, hi };
    });
    g = Infinity;
    for (let i = 0; i < nL - 1; i += 1) {
      const a = prof[i];
      const b = prof[i + 1];
      for (let y = 0; y < chh; y += 1) {
        if (Number.isNaN(a.hi[y]) || Number.isNaN(b.lo[y])) continue;
        g = Math.min(g, prefix[i + 1] + b.lo[y] - (prefix[i] + a.hi[y]));
      }
    }
    g = Number.isFinite(g) ? g / S : 0.05;
    gcache.set(w, g);
    return g;
  };
  const inkGap = (w) => {
    const a = Math.floor(w / INK_STEP) * INK_STEP;
    const t = (w - a) / INK_STEP;
    const ga = inkGapAt(a);
    return t > 0 ? ga + (inkGapAt(a + INK_STEP) - ga) * t : ga;
  };
  const metrics = (w) => {
    let m = mcache.get(w);
    if (!m) {
      mctx.font = fontAt(w, REF);
      const prefix = origins(mctx).map((v) => v / REF);
      const tm = mctx.measureText(WORD);
      // The floor: the tightest tracking, in em, that still leaves CLEAR
      // between the closest pair of this cut.
      // Each letter's own ink, left and right of its origin, so a colour
      // edge in motion can cross the whole glyph and leave no sliver behind.
      const ink = chars.map((ch) => {
        const t = mctx.measureText(ch);
        return [-t.actualBoundingBoxLeft / REF, t.actualBoundingBoxRight / REF];
      });
      m = { prefix, ink, asc: tm.actualBoundingBoxAscent / REF, floor: CLEAR - inkGap(w) };
      mcache.set(w, m);
    }
    return m;
  };
  // Tracking at a rendered size: the law, held at the cut's floor.
  const trackOf = (S, m) => Math.max(lawPx(S), m.floor * S);
  // The size at which this cut, tracked by trackOf, measures `width`
  // (slant included). Width grows with size on both branches of the max,
  // so the fit is the smaller of the two branch solutions.
  const sizeForWidth = (width, m, tan) => {
    const n1 = nL - 1;
    const ext = m.prefix[nL] + tan * m.asc;
    const byLaw = (width - n1 * 0.043 * 12) / (ext - 0.043 * n1);
    const byFloor = width / (ext + m.floor * n1);
    return Math.min(byLaw, byFloor);
  };
  const mBold = metrics(L.bold);
  // The word's own box, in em: the bold advance (tracking at display size
  // is ~ -0.043 em a gap) against its ascender plus the rule allowance.
  // The sheet is proportioned on the law alone; where the floor holds the
  // bold cut a little open, the fit gives it back in size, not in width.
  const advEm = (m) => m.prefix[nL] - 0.043 * (nL - 1);
  const ASPECT = ((1 - 2 * PAD) * advEm(mBold)) / (mBold.asc + RULE_K) + 2 * PAD;

  // ── Grid ───────────────────────────────────────────────────────────
  let W = 1;
  let H = 1;
  let cols = 5;
  let rows = 4;
  let G = { x: 0, y: 0, w: 1, h: 1, cw: 1, ch: 1 };
  let cells = [];
  let stepCache = null;

  const makeCells = () => {
    const old = cells;
    cells = [];
    for (let j = 0; j < rows; j += 1) {
      for (let i = 0; i < cols; i += 1) {
        const prev = old[0];
        cells.push({ i, j, ax: prev ? prev.ax : TX, vx: 0, ay: prev ? prev.ay : TY, vy: 0, P: {} });
      }
    }
    stepCache = VARS.map((v) => ({ c: v.steps(cols), r: v.steps(rows) }));
  };

  stage.onResize((w, h) => {
    W = w;
    H = h;
    const portrait = h > w * 1.1;
    const mx = Math.max(16, Math.round(w * (embedded ? 0.06 : 0.085)));
    const my = Math.max(16, Math.round(h * (embedded ? 0.08 : 0.1)));
    const aw = w - 2 * mx;
    const ah = h - 2 * my;
    // Every cell has the word's proportion; pick the count of columns and
    // rows that covers the most of the page with it, keeping the sheet
    // dense (six rows or more) and at least two columns to compare.
    let best = null;
    for (let nc = 2; nc <= 6; nc += 1) {
      for (let nr = 6; nr <= (portrait ? 12 : 8); nr += 1) {
        const cwf = Math.min(aw / nc, (ah / nr) * ASPECT);
        const area = nc * nr * cwf * cwf;
        if (!best || area > best.area * 1.02) best = { nc, nr, cwf, area };
      }
    }
    const { nc, nr } = best;
    const ch = Math.max(1, Math.floor(best.cwf / ASPECT));
    const cw = Math.min(Math.floor(aw / nc), Math.round(ch * ASPECT));
    const gw = cw * nc;
    const gh = ch * nr;
    G = { x: Math.round((w - gw) / 2), y: Math.round((h - gh) / 2), w: gw, h: gh, cw, ch };
    if (nc !== cols || nr !== rows || !cells.length) {
      cols = nc;
      rows = nr;
      makeCells();
    }
    dirty = true;
  });

  // ── Targets and the wave ───────────────────────────────────────────
  const params = new URLSearchParams(location.search);
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const axesQ = (params.get("axes") || "").split(/[,.]/).filter(Boolean);
  const stillT = params.has("t") ? clamp(+params.get("t") || 0, 0, 1) : null;
  const promoteQ = params.has("promote") ? Math.max(0, Math.floor(+params.get("promote") || 0)) : null;
  const promoteG = params.has("g") ? clamp(+params.get("g") || 0, 0, 1) : 1;
  const still = stillT !== null || axesQ.length > 0 || promoteQ !== null;

  let TX = 0; // column variable, as a continuous index into VARS
  let TY = 1; // row variable
  let fromPair = [idx("reversal", 4), idx("weight", 0)]; // the opening pair
  let toPair = null;
  if (axesQ.length >= 4) {
    fromPair = [idx(axesQ[0], 4), idx(axesQ[1], 0)];
    toPair = [idx(axesQ[2], 0), idx(axesQ[3], 1)];
  } else if (axesQ.length >= 2) {
    if (stillT !== null) toPair = [idx(axesQ[0], 0), idx(axesQ[1], 1)];
    else fromPair = [idx(axesQ[0], 4), idx(axesQ[1], 0)];
  } else if (stillT !== null) {
    toPair = [idx("red", 5), idx("size", 1)];
  }
  // Travel the short way round the box.
  const nearest = (from, to) => {
    let d = to - from;
    while (d > V / 2) d -= V;
    while (d < -V / 2) d += V;
    return from + d;
  };
  TX = fromPair[0];
  TY = fromPair[1];

  // History of targets, each with the point the change came from (in
  // cell units). A cell takes the newest entry whose wave has reached it.
  let hist = [{ t: -1e9, tx: TX, ty: TY, ox: 0, oy: 0 }];
  let now = 0;
  const push = (tx, ty, ox, oy) => {
    TX = tx;
    TY = ty;
    hist.push({ t: now, tx, ty, ox, oy });
    // Forget what every cell has already passed.
    const cutoff = now - 1.5;
    let k = 0;
    while (k < hist.length - 1 && hist[k + 1].t < cutoff) k += 1;
    if (k > 0) hist = hist.slice(k);
    dirty = true;
  };
  const targetOf = (c) => {
    const cx = c.i + 0.5;
    const cy = c.j + 0.5;
    for (let k = hist.length - 1; k > 0; k -= 1) {
      const e = hist[k];
      const lag = reduced ? 0 : Math.hypot(cx - e.ox, cy - e.oy) * DELAY;
      if (now >= e.t + lag) return e;
    }
    return hist[0];
  };

  let dirty = true;
  const step = (h) => {
    now += h;
    const k = OMEGA * OMEGA;
    const d = 2 * ZETA * OMEGA;
    let moving = false;
    for (const c of cells) {
      const e = targetOf(c);
      c.vx += (-k * (c.ax - e.tx) - d * c.vx) * h;
      c.ax += c.vx * h;
      c.vy += (-k * (c.ay - e.ty) - d * c.vy) * h;
      c.ay += c.vy * h;
      if (Math.abs(c.ax - e.tx) > 1e-4 || Math.abs(c.vx) > 1e-4 || Math.abs(c.ay - e.ty) > 1e-4 || Math.abs(c.vy) > 1e-4 || e !== hist[hist.length - 1]) moving = true;
    }
    // Promotion: progress runs at an even pace, one hairline per STEP_T;
    // the easing lives in each step, so every edge lands on its rule.
    if (promo.cell >= 0 && promo.g !== promo.target) {
      const rate = 1 / (Math.max(1, bandOf(cells[promo.cell], 0).n) * STEP_T);
      promo.g = promo.target > promo.g ? Math.min(promo.target, promo.g + rate * h) : Math.max(promo.target, promo.g - rate * h);
      moving = true;
    } else if (promo.target === 0) promo.cell = -1;
    if (promo.target === 1 && !still && now > promo.until) promo.target = 0;
    if (moving) dirty = true;
  };

  // ── Parameters of a cell ───────────────────────────────────────────
  const paramsOf = (c) => {
    const P = c.P;
    for (let k = 0; k < V; k += 1) {
      const v = VARS[k];
      const ic = Math.max(0, 1 - circ(c.ax, k));
      const ir = Math.max(0, 1 - circ(c.ay, k));
      let x = v.def;
      if (ic > 0) x += ic * (stepCache[k].c[c.i] - v.def);
      if (ir > 0) x += ir * (stepCache[k].r[c.j] - v.def);
      P[v.key] = clamp(x, v.lo, v.hi);
    }
    return P;
  };

  // ── Input ──────────────────────────────────────────────────────────
  const promo = { cell: -1, g: 0, target: 0, until: 0 };

  // The band a promoted cell grows into, in grid units. It grows out
  // along the rules one hairline at a time, a column and a row together on
  // every step, to the full width of the sheet and a block as many rows
  // deep as there are columns. The cell has the word's proportion, so a
  // band n cells by n cells has it too: at every step, and at every instant
  // between steps, the band is the cell scaled up, and the logotype re-set
  // inside it grows with it instead of sitting small in an open strip.
  // Each step eases onto its hairline and rests there before the next, so
  // the band is always a whole number of cells at rest.
  const ease = (s) => {
    const t = clamp(s / STEP_MOVE, 0, 1);
    return t * t * t * (t * (t * 6 - 15) + 10);
  };
  // One axis: nLo cells to take on one side, nHi on the other, nA steps.
  // Each step moves exactly one of the two edges, the near side paced so
  // that both sides reach the sheet's edge together.
  const grow = (s, nA, nLo, nHi) => {
    if (nA <= 0) return [0, 0];
    const lo = (m) => (m >= nA ? nLo : Math.round((m * nLo) / nA));
    const f = Math.min(nA, Math.floor(s));
    const t = f >= nA ? 0 : ease(s - f);
    const l = lo(f) + (lo(f + 1) - lo(f)) * t;
    const h = f - lo(f) + (f + 1 - lo(f + 1) - (f - lo(f))) * t;
    return [l, Math.min(nHi, h)];
  };
  const bandOf = (c, g) => {
    const k = Math.min(rows, cols);
    const top = clamp(c.j - Math.floor((k - 1) / 2), 0, rows - k);
    const nC = cols - 1;
    const nR = k - 1;
    const n = Math.max(nC, nR);
    const s = clamp(g, 0, 1) * n;
    const [l, r] = grow((s * nC) / Math.max(1, n), nC, c.i, cols - 1 - c.i);
    const [t, b] = grow((s * nR) / Math.max(1, n), nR, c.j - top, top + k - 1 - c.j);
    return { i0: c.i - l, i1: c.i + 1 + r, j0: c.j - t, j1: c.j + 1 + b, n };
  };
  let drag = null;
  let touched = false;
  const stepPx = () => Math.max(110, G.cw * 1.25);
  const cellAt = (x, y) => {
    const i = Math.floor((x - G.x) / G.cw);
    const j = Math.floor((y - G.y) / G.ch);
    if (i < 0 || j < 0 || i >= cols || j >= rows) return -1;
    return j * cols + i;
  };
  const toCell = (x, y) => [(x - G.x) / G.cw, (y - G.y) / G.ch];

  stage.on("down", (p) => {
    touched = true;
    drag = { x: p.x, y: p.y, tx: TX, ty: TY, live: false };
    canvas.style.cursor = "grabbing";
  });
  stage.on("move", (p) => {
    if (!drag) return;
    const dx = p.x - drag.x;
    const dy = p.y - drag.y;
    if (!drag.live && Math.hypot(dx, dy) < 6) return;
    if (!drag.live && promo.target === 1) promo.target = 0;
    drag.live = true;
    const [ox, oy] = toCell(p.x, p.y);
    push(drag.tx + dx / stepPx(), drag.ty + dy / stepPx(), ox, oy);
  });
  stage.on("up", (p) => {
    canvas.style.cursor = "grab";
    const d = drag;
    drag = null;
    if (!d) return;
    if (!d.live) {
      if (promo.target === 1) {
        promo.target = 0;
      } else {
        const ci = cellAt(p.x, p.y);
        if (ci >= 0) {
          promo.cell = ci;
          promo.target = 1;
          promo.until = now + bandOf(cells[ci], 0).n * STEP_T + HOLD;
        }
      }
      dirty = true;
      return;
    }
    // Snap to whole rows of the box, carrying a little of the throw.
    let tx = Math.round(TX + (p.vx * 0.12) / stepPx());
    let ty = Math.round(TY + (p.vy * 0.12) / stepPx());
    if (wrap(tx) === wrap(ty)) ty += Math.abs(p.y - d.y) >= 1 ? Math.sign(p.y - d.y) || 1 : 1;
    const [ox, oy] = toCell(p.x, p.y);
    push(tx, ty, ox, oy);
  });

  // ── Drawing ────────────────────────────────────────────────────────
  const hair = (v, dpr) => (Math.round(v * dpr) + 0.5) / dpr;

  const drawCell = (r, P, dpr, centre = false) => {
    const pad = Math.max(1, Math.round(Math.min(r.w, r.h) * PAD));
    const innerW = r.w - 2 * pad;
    // Bottom margin: the pad, opening to the rule's clearance as the rule
    // comes in. The word and its rule are fitted above it.
    const clr = pad + Math.max(0, RULE_CLEAR * r.h - pad) * clamp(P.rule / RULE_OPEN, 0, 1);
    const innerH = r.h - pad - clr;
    const wt = Math.round(P.weight);
    const m = metrics(wt);
    const tan = Math.tan((P.slope * Math.PI) / 180);
    // Size that sets this cut flush across the inner measure, tracking and
    // slant included, bounded by the height the word and its rule need.
    // The cell has the bold word's proportion, so at size 1 every variant
    // meets the pad on the sides, and the top and bottom as nearly as its
    // cut allows.
    const widthFit = sizeForWidth(innerW, m, tan);
    const heightFit = innerH / (m.asc + RULE_K * P.rule);
    const fit = Math.min(widthFit, heightFit);
    const S = Math.max(4, P.size * fit);
    const track = trackOf(S, m);
    const xs = new Array(nL + 1);
    for (let i = 0; i <= nL; i += 1) xs[i] = m.prefix[i] * S + i * track;
    const wordW = xs[nL] - track;
    const visW = wordW + tan * m.asc * S;
    // Past size 1 the word runs off the cell and is cropped by it: it grows
    // from the side it is aligned to, and up from the baseline. A centred
    // setting (the promoted band) splits any measure the cut leaves over
    // evenly about the same inset, so the logotype sits square in its box.
    const x0 = r.x + pad + (centre && visW <= innerW ? 0.5 : P.align) * (innerW - visW);
    const blockH = (m.asc + RULE_K * P.rule) * S;
    const spare = Math.max(0, innerH - blockH);
    const by = r.y + r.h - clr - RULE_K * P.rule * S - spare / 2;
    const blockTop = r.y + r.h - P.reversal * r.h;
    // Red runs from the left, letter by letter. At rest whole glyphs take
    // the colour, so a letter that overlaps its neighbour under tight
    // tracking never shows a sliver of the other ink; in motion the edge
    // crosses each letter's own ink. The rule's edge sits in the middle
    // of the gap.
    const rf = P.red * nL;
    const edgeAt = (k) => (k <= 0 ? -track * 0.5 - S : k >= nL ? xs[nL] + S : xs[k] - track * 0.5);
    const k0 = Math.floor(rf);
    const redX = x0 + edgeAt(k0) + (edgeAt(Math.min(nL, k0 + 1)) - edgeAt(k0)) * (rf - k0);

    ctx.save();
    ctx.beginPath();
    ctx.rect(r.x, r.y, r.w, r.h);
    ctx.clip();
    if (P.reversal > 0.0005) {
      ctx.fillStyle = INK;
      ctx.fillRect(r.x, blockTop, r.w, r.y + r.h - blockTop);
    }
    ctx.font = fontAt(wt, S);
    const regions = [
      [r.y, blockTop, false, INK],
      [r.y, blockTop, true, RED],
      [blockTop, r.y + r.h, false, GROUND],
      [blockTop, r.y + r.h, true, RED],
    ];
    for (const [y0, y1, red, color] of regions) {
      if (y1 - y0 < 0.01) continue;
      if (red && P.red < 0.0005) continue;
      if (!red && P.red > 0.9995) continue;
      ctx.save();
      ctx.beginPath();
      ctx.rect(r.x, y0, r.w, y1 - y0);
      ctx.clip();
      // Shear about the baseline: x' = x - tan (y - by).
      ctx.setTransform(dpr, 0, -tan * dpr, dpr, tan * by * dpr, 0);
      ctx.fillStyle = color;
      for (let i = 0; i < nL; i += 1) {
        const f = clamp(rf - i, 0, 1);
        if (red ? f < 0.0005 : f > 0.9995) continue;
        const gx = x0 + xs[i];
        if (f > 0.0005 && f < 0.9995) {
          const [il, ir] = m.ink[i];
          const ex = gx + (il + f * (ir - il)) * S;
          ctx.save();
          ctx.beginPath();
          if (red) ctx.rect(gx - S, r.y - r.h, ex - gx + S, r.h * 3);
          else ctx.rect(ex, r.y - r.h, r.w * 3, r.h * 3);
          ctx.clip();
          ctx.fillText(chars[i], gx, by);
          ctx.restore();
        } else {
          ctx.fillText(chars[i], gx, by);
        }
      }
      if (P.rule > 0.0005) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        const th = RULE_TH * P.rule * S;
        const ry = by + RULE_GAP * P.rule * S;
        const a = red ? x0 : Math.max(x0, redX);
        const b = red ? Math.min(x0 + wordW, redX) : x0 + wordW;
        if (b > a) ctx.fillRect(a, ry, b - a, th);
      }
      ctx.restore();
    }
    ctx.restore();
  };

  const draw = () => {
    const dpr = stage.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = "alphabetic";
    ctx.fontKerning = "normal";

    // The promoted band, in grid units and in pixels. Its edges sit on the
    // rules whenever it is at rest, and every cell it covers whole is left
    // out, so the band reads as a strip of the sheet, not a card over it.
    let band = null;
    if (promo.cell >= 0 && promo.g > 0.0005) {
      const b = bandOf(cells[promo.cell], promo.g);
      const x0 = G.x + b.i0 * G.cw;
      const y0 = G.y + b.j0 * G.ch;
      band = {
        ...b,
        r: { x: x0, y: y0, w: G.x + b.i1 * G.cw - x0, h: G.y + b.j1 * G.ch - y0 },
      };
    }
    const E = 1e-3;
    const covered = (c) => band && c.i >= band.i0 - E && c.i + 1 <= band.i1 + E && c.j >= band.j0 - E && c.j + 1 <= band.j1 + E;

    // A cell the moving band has begun to enter is re-set in the box it
    // has left, so it gives way to the band, narrowing or shortening, and
    // is never cut through a letter. Where the band's corner takes a bite
    // out of a cell, it is set in the larger of the two strips left.
    const leftOf = (c) => {
      const r = { x: G.x + c.i * G.cw, y: G.y + c.j * G.ch, w: G.cw, h: G.ch };
      if (!band) return r;
      const bx0 = G.x + band.i0 * G.cw;
      const bx1 = G.x + band.i1 * G.cw;
      const by0 = G.y + band.j0 * G.ch;
      const by1 = G.y + band.j1 * G.ch;
      const ox = Math.min(r.x + r.w, bx1) - Math.max(r.x, bx0);
      const oy = Math.min(r.y + r.h, by1) - Math.max(r.y, by0);
      if (ox <= 0.01 || oy <= 0.01) return r;
      // Strips beside the band (full height) and above or below it (full width).
      const sx = bx0 > r.x + 0.01 ? { x: r.x, w: bx0 - r.x } : { x: bx1, w: r.x + r.w - bx1 };
      const sy = by0 > r.y + 0.01 ? { y: r.y, h: by0 - r.y } : { y: by1, h: r.y + r.h - by1 };
      const horiz = { x: sx.x, y: r.y, w: Math.max(0, sx.w), h: r.h };
      const vert = { x: r.x, y: sy.y, w: r.w, h: Math.max(0, sy.h) };
      return horiz.w * horiz.h >= vert.w * vert.h ? horiz : vert;
    };
    for (const c of cells) {
      if (covered(c)) continue;
      const r = leftOf(c);
      if (r.w < 1 || r.h < 1) continue;
      drawCell(r, paramsOf(c), dpr);
    }

    // Ruled grid: one device pixel, full ink.
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1 / dpr;
    ctx.beginPath();
    for (let i = 0; i <= cols; i += 1) {
      const x = hair(G.x + i * G.cw, dpr);
      ctx.moveTo(x, G.y);
      ctx.lineTo(x, G.y + G.h);
    }
    for (let j = 0; j <= rows; j += 1) {
      const y = hair(G.y + j * G.ch, dpr);
      ctx.moveTo(G.x, y);
      ctx.lineTo(G.x + G.w, y);
    }
    ctx.stroke();

    // The chosen logotype, pasted into the sheet as a band. In motion an
    // edge crosses a cell and cuts it cleanly; at rest the band is whole
    // cells and its outline is the grid's own rules.
    if (band) {
      const { r } = band;
      const px = (v) => Math.round(v * dpr) / dpr;
      const rr = { x: px(r.x), y: px(r.y), w: px(r.x + r.w) - px(r.x), h: px(r.y + r.h) - px(r.y) };
      ctx.fillStyle = GROUND;
      ctx.fillRect(rr.x, rr.y, rr.w, rr.h);
      drawCell(rr, paramsOf(cells[promo.cell]), dpr, true);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1 / dpr;
      ctx.strokeRect(hair(rr.x, dpr), hair(rr.y, dpr), rr.w, rr.h);
    }
  };

  // ── The programme runs itself until someone takes over ─────────────
  let nextAuto = 2.4;
  let autoTurn = 0;
  const auto = () => {
    if (still || touched || drag || now < nextAuto) return;
    if (embedded ? false : autoTurn >= 4) return;
    autoTurn += 1;
    nextAuto = now + 3.6;
    const byCol = autoTurn % 2 === 1;
    let tx = TX;
    let ty = TY;
    if (byCol) tx += 1;
    else ty += 1;
    if (wrap(tx) === wrap(ty)) {
      if (byCol) tx += 1;
      else ty += 1;
    }
    push(tx, ty, byCol ? 0 : cols / 2, byCol ? rows / 2 : 0);
  };

  // ── Stills: ?axes=a,b[,c,d] and ?t=, ?promote=&g= ──────────────────
  const FIXED = 1 / 240;
  let frozen = false;
  const settle = () => {
    for (let s = 0; s < 240 * 2; s += 1) step(FIXED);
  };
  const buildStill = () => {
    settle();
    if (toPair) {
      const tx = nearest(TX, toPair[0]);
      const ty = nearest(TY, toPair[1]);
      push(tx, ty, 0, 0);
      const span = Math.hypot(cols, rows) * DELAY + 0.75;
      const steps = Math.round(((stillT ?? 1) * span) / FIXED);
      for (let s = 0; s < steps; s += 1) step(FIXED);
    }
    if (promoteQ !== null && cells[promoteQ]) {
      promo.cell = promoteQ;
      promo.target = 1;
      promo.g = promoteG;
    }
    frozen = true;
    dirty = true;
  };

  let acc = 0;
  let built = false;
  stage.onFrame((dt) => {
    if (still) {
      if (!built && cells.length && G.cw > 1) {
        built = true;
        buildStill();
      }
    } else {
      auto();
      acc += dt;
      while (acc >= FIXED) {
        acc -= FIXED;
        step(FIXED);
      }
    }
    if (!dirty) return;
    dirty = false;
    draw();
  });

  return {
    destroy() {
      stage.destroy();
    },
  };
}
