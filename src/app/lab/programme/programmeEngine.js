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
// cell: that variant grows into a full-width band of the sheet, holds, and
// goes back.
//
// The cells take their proportion from the word itself: the bold cut's
// advance against its ascender plus the rule allowance, so at its default
// size every variant sits flush across its cell with a small, equal pad, the
// way Gerstner's typograms are set edge to edge. The size axis runs past 1
// and crops at the cell, rather than shrinking the word into blank ground.
//
// Type follows the house law at every rendered size, including every size
// passed through while a cell grows: tracking = -0.043 x (size - 12) px.
// Resting weights are read from the --font-weight-* ladder tokens.

const FAMILY = "ProgrammeGeist";
const WORD = "raster";
const INK = "#0d0d0c";
const GROUND = "#f5f4f0";
const RED = "#d9261c";
const lawPx = (s) => -0.043 * (s - 12);

const OMEGA = 12; // cell spring
const ZETA = 0.86; // a touch under critical: one soft settle, no bounce
const DELAY = 0.055; // seconds of wave lag per cell of distance
const P_OMEGA = 9; // promotion spring (critically damped)
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
  const metrics = (w) => {
    let m = mcache.get(w);
    if (!m) {
      mctx.font = fontAt(w, REF);
      // Prefix widths carry the font's own kerning.
      const prefix = [0];
      for (let i = 1; i <= nL; i += 1) prefix.push(mctx.measureText(WORD.slice(0, i)).width / REF);
      const tm = mctx.measureText(WORD);
      m = { prefix, asc: tm.actualBoundingBoxAscent / REF };
      mcache.set(w, m);
    }
    return m;
  };
  const mBold = metrics(L.bold);
  // The word's own box, in em: the bold advance (tracking at display size
  // is ~ -0.043 em a gap) against its ascender plus the rule allowance.
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
    // Promotion spring.
    const pk = P_OMEGA * P_OMEGA;
    const pd = 2 * P_OMEGA;
    promo.v += (-pk * (promo.g - promo.target) - pd * promo.v) * h;
    promo.g += promo.v * h;
    if (Math.abs(promo.g - promo.target) > 1e-4 || Math.abs(promo.v) > 1e-4) moving = true;
    else if (promo.target === 0) promo.cell = -1;
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
  const promo = { cell: -1, g: 0, v: 0, target: 0, until: 0 };
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
          promo.until = now + HOLD;
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

  const drawCell = (r, P, dpr) => {
    const pad = Math.max(1, Math.round(Math.min(r.w, r.h) * PAD));
    const innerW = r.w - 2 * pad;
    const innerH = r.h - 2 * pad;
    const wt = Math.round(P.weight);
    const m = metrics(wt);
    const n1 = nL - 1;
    const tan = Math.tan((P.slope * Math.PI) / 180);
    // Size that sets this cut flush across the inner measure, tracking and
    // slant included, bounded by the height the word and its rule need.
    // The cell has the bold word's proportion, so at size 1 every variant
    // meets the pad on the sides, and the top and bottom as nearly as its
    // cut allows.
    const widthFit = (innerW - n1 * 0.043 * 12) / (advEm(m) + tan * m.asc);
    const heightFit = innerH / (m.asc + RULE_K * P.rule);
    const fit = Math.min(widthFit, heightFit);
    const S = Math.max(4, P.size * fit);
    const track = lawPx(S);
    const xs = new Array(nL + 1);
    for (let i = 0; i <= nL; i += 1) xs[i] = m.prefix[i] * S + i * track;
    const wordW = xs[nL] - track;
    const visW = wordW + tan * m.asc * S;
    // Past size 1 the word runs off the cell and is cropped by it: it grows
    // from the side it is aligned to, and up from the baseline.
    const x0 = r.x + pad + P.align * (innerW - visW);
    const blockH = (m.asc + RULE_K * P.rule) * S;
    const spare = Math.max(0, innerH - blockH);
    const by = r.y + r.h - pad - RULE_K * P.rule * S - spare / 2;
    const blockTop = r.y + r.h - P.reversal * r.h;
    // Red runs from the left, letter by letter. At rest whole glyphs take
    // the colour, so a letter that overlaps its neighbour under tight
    // tracking never shows a sliver of the other ink; in motion the edge
    // crosses each letter's own advance. The rule's edge sits in the middle
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
          const ex = gx + f * (xs[i + 1] - xs[i]);
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

    for (const c of cells) {
      if (c === cells[promo.cell] && promo.g > 0.999) continue;
      drawCell({ x: G.x + c.i * G.cw, y: G.y + c.j * G.ch, w: G.cw, h: G.ch }, paramsOf(c), dpr);
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

    // The chosen logotype, growing out of its cell into a band across the
    // whole sheet. The band keeps the cell's proportion, so it lands on the
    // rules as many rows deep as there are columns, centred on the cell's
    // row, and the word fills it edge to edge.
    if (promo.cell >= 0 && promo.g > 0.0005) {
      const c = cells[promo.cell];
      const g = clamp(promo.g, 0, 1);
      const sx = G.x + c.i * G.cw;
      const sy = G.y + c.j * G.ch;
      const k = Math.min(rows, cols);
      const j0 = clamp(c.j - Math.floor((k - 1) / 2), 0, rows - k);
      const ty = G.y + j0 * G.ch;
      const th = k * G.ch;
      const r = {
        x: Math.round(sx + (G.x - sx) * g),
        y: Math.round(sy + (ty - sy) * g),
        w: Math.round(G.cw + (G.w - G.cw) * g),
        h: Math.round(G.ch + (th - G.ch) * g),
      };
      ctx.fillStyle = GROUND;
      ctx.fillRect(r.x, r.y, r.w, r.h);
      drawCell(r, paramsOf(c), dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1 / dpr;
      ctx.strokeRect(hair(r.x, dpr), hair(r.y, dpr), Math.round(r.w * dpr) / dpr, Math.round(r.h * dpr) / dpr);
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
      promo.v = 0;
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
