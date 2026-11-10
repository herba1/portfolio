// Coup de dés: Mallarmé's threads as rigid bodies on critically damped
// springs. A thread is one body: its lines ride at fixed offsets from it, so
// it travels, turns and lands whole.
// A sweep across the spread is the throw. Each throw composes a new
// constellation under fixed rules on a hidden fourteen-column grid: the four
// great capitals step down the spread on the diagonal, standing on column
// lines; one of them is the throw's thunderclap, near a quarter of the page
// high, and takes the spine dead centre, while the other three fall away to
// about a third of its size and each stands on a page, a column clear of it; each minor thread lands where it shares the
// most edges with the capitals (a left edge, a right edge, a baseline, a cap
// height, a column line), with whitespace only breaking ties; and only the
// capitals may cross the gutter.
//
// ?t=0.4 freezes the scene that many seconds after a scripted throw.
// ?seed=n picks the constellation.

// Mallarmé breaks his phrases into cascades: a thread of one size and cut,
// each line starting where the last one stopped ("stair") or hanging under
// it ("flush"). The minor lines move as these threads.
//
// And the page speaks in two voices. The main sentence, RIEN and EXCEPTÉ
// stand in the roman grotesk; the subordinate threads answer in the serif
// italic. The voice belongs to the thread, so it survives every throw.
const BLOCKS = [
  { tier: 0, voice: "roman", lines: ["UN COUP DE DÉS"] },
  { tier: 0, voice: "roman", lines: ["JAMAIS"] },
  { tier: 0, voice: "roman", lines: ["N’ABOLIRA"] },
  { tier: 0, voice: "roman", lines: ["LE HASARD"] },
  { tier: 1, voice: "roman", lines: ["RIEN", "N’AURA EU LIEU", "QUE LE LIEU"] },
  { tier: 1, voice: "roman", lines: ["EXCEPTÉ", "PEUT-ÊTRE", "UNE CONSTELLATION"] },
  { tier: 1, voice: "italic", lines: ["COMME SI"] },
  { tier: 1, voice: "roman", lines: ["DU FOND D’UN NAUFRAGE"] },
  { tier: 2, voice: "italic", lines: ["soit", "que", "l’Abîme", "blanchi", "étale", "furieux"] },
  { tier: 2, voice: "italic", lines: ["une insinuation simple", "au silence enroulée avec ironie"] },
  { tier: 2, voice: "italic", lines: ["Toute Pensée émet un Coup de Dés"] },
];
const LINES = BLOCKS.flatMap((b, bi) => b.lines.map((text, li) => ({ text, tier: b.tier, voice: b.voice, block: bi, line: li })));

// The threads in the roman whisper beside the capitals: small caps-height
// lines at the semibold cut, thinning to the meta cut in flight.
const TIER1_SIZES = [16, 18, 20];
const TIER2_SIZES = [13, 14, 16, 18];

// The house tracking law, applied to whatever size a line is at this frame.
const lawPx = (size) => -0.043 * (size - 12);
const tracking = (size) => (size < 20 ? `${lawPx(size).toFixed(3)}px` : `${(lawPx(size) / size).toFixed(4)}em`);
const lineHeight = (size) => Math.max(4, Math.round((size * 1.08) / 4) * 4);

// The italic is emphasis against the roman at the thread's size, so it takes
// the four compensations together: 1.07em, the 430 cut, "opsz" 10 (all in
// the CSS), and its tracking opened 0.16px past the law's answer. Its lines
// are set on the leading of the italic's own size, on the 4px grid.
const SERIF_SIZE = 1.07;
const SERIF_OPEN = 0.16;
const isItalic = (voice) => voice === "italic";
const trackingFor = (voice, size) => {
  if (!isItalic(voice)) return tracking(size);
  const px = lawPx(size) + SERIF_OPEN;
  return size < 20 ? `${px.toFixed(3)}px` : `${(px / size).toFixed(4)}em`;
};
const leadFor = (voice, size) => lineHeight(isItalic(voice) ? size * SERIF_SIZE : size);
const snap4 = (v) => Math.round(v / 4) * 4;

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export async function createCoup(host, { embedded = false } = {}) {
  const box = host.closest(".piece-box") || host;
  const params = new URLSearchParams(window.location.search);
  const freezeT = params.has("t") ? Math.max(0, parseFloat(params.get("t")) || 0) : null;
  const baseSeed = parseInt(params.get("seed") || "7", 10) || 7;
  let seed = baseSeed;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const gutter = document.createElement("div");
  gutter.className = "coup-gutter";
  host.appendChild(gutter);

  const measurer = document.createElement("span");
  measurer.className = "coup-thread coup-measure";
  measurer.setAttribute("aria-hidden", "true");
  host.appendChild(measurer);

  // One element per thread; the lines are spans inside it.
  const bodies = BLOCKS.map((b, bi) => {
    const el = document.createElement("div");
    el.className = "coup-thread";
    el.dataset.tier = String(b.tier);
    el.dataset.voice = b.voice;
    el.setAttribute("role", "presentation");
    host.appendChild(el);
    return {
      bi,
      tier: b.tier,
      voice: b.voice,
      el,
      lines: [],
      x: 0, y: 0, s: 16, r: 0, m: 1,
      vx: 0, vy: 0, vs: 0, vr: 0, vm: 0,
      tx: 0, ty: 0, ts: 16,
      // the thread's shape: line offsets in em, from the last layout to the
      // next, crossed by m as the body flies
      from: [],
      to: [],
      next: null,
      at: 0,
      k: 120,
      mass: b.tier === 0 ? 0.42 : b.tier === 1 ? 0.75 : 1,
      hidden: false,
      shown: -1,
      shownW: -1,
      shownZ: -1,
      shownM: -1,
    };
  });

  const items = LINES.map((line, i) => {
    const el = document.createElement("span");
    el.className = "coup-line";
    el.textContent = line.text;
    const body = bodies[line.block];
    body.el.appendChild(el);
    const it = { ...line, i, el, body };
    body.lines.push(it);
    return it;
  });

  // Make sure every cut is loaded before anything is measured.
  try {
    const cs = getComputedStyle(host);
    const family = cs.fontFamily;
    const serifFamily = cs.getPropertyValue("--coup-serif").trim();
    await Promise.all([
      document.fonts.load(`700 80px ${family}`, "UN COUP DE DÉS"),
      document.fonts.load(`600 24px ${family}`, "RIEN"),
      document.fonts.load(`440 16px ${family}`, "soit"),
      document.fonts.load(`490 13px ${family}`, "soit"),
      serifFamily && document.fonts.load(`italic 430 16px ${serifFamily}`, "soit l’Abîme COMME SI"),
    ]);
    await document.fonts.ready;
  } catch {
    /* measure with whatever is there */
  }

  // Weight is the line's state: a line in flight thins to the meta cut and
  // fills back in as it lands, so lines passing one another read as passing.
  const tok = getComputedStyle(host);
  const wt = (name, fb) => parseFloat(tok.getPropertyValue(name)) || fb;
  const REST_W = [wt("--font-weight-bold", 700), wt("--font-weight-semibold", 600)];
  const FLIGHT_W = wt("--font-weight-meta", 440);
  const SERIF_W = wt("--font-weight-serif", 430);
  const serif = tok.getPropertyValue("--coup-serif").trim() || "serif";

  const widths = new Map();
  const measure = (item, size) => {
    const key = `${item.i}|${size}`;
    let wv = widths.get(key);
    if (wv == null) {
      measurer.dataset.tier = String(item.tier);
      measurer.dataset.voice = item.voice;
      if (item.tier === 2 && size <= 13) measurer.dataset.small = "";
      else delete measurer.dataset.small;
      measurer.style.fontSize = `${isItalic(item.voice) ? size * SERIF_SIZE : size}px`;
      // resolved to px here: the measurer is set at the italic's own size,
      // which an em would be read against
      measurer.style.letterSpacing = isItalic(item.voice) ? `${(lawPx(size) + SERIF_OPEN).toFixed(3)}px` : tracking(size);
      measurer.textContent = item.text;
      wv = measurer.getBoundingClientRect().width;
      widths.set(key, wv);
    }
    return wv;
  };

  // Alignment is read off the ink, not the box: a capital at 84px stands a
  // few pixels inside its own left edge (the thunderclap many more), and a 14px line beside it barely
  // does. These are the glyph extents of a line at rest, relative to its box.
  const family = tok.fontFamily;
  const TIER2_W = [wt("--font-weight-meta", 440), wt("--font-weight-body-sm", 490)];
  const restWeight = (tier, size) => (tier === 2 ? TIER2_W[size <= 13 ? 1 : 0] : REST_W[tier]);
  const pen = document.createElement("canvas").getContext("2d");
  const inks = new Map();
  const ink = (item, size) => {
    const key = `${item.i}|${size}`;
    let v = inks.get(key);
    if (v == null) {
      const it = isItalic(item.voice);
      pen.font = it ? `italic ${SERIF_W} ${size * SERIF_SIZE}px ${serif}` : `${restWeight(item.tier, size)} ${size}px ${family}`;
      if ("letterSpacing" in pen) pen.letterSpacing = `${(lawPx(size) + (it ? SERIF_OPEN : 0)).toFixed(3)}px`;
      const m = pen.measureText(item.text);
      v = { l: -m.actualBoundingBoxLeft, r: m.actualBoundingBoxRight };
      // the canvas cannot set "opsz", so the italic's advance is read off the
      // page and only its side bearings off the canvas
      if (it) v.r = measure(item, size) - (m.width - m.actualBoundingBoxRight);
      if (!Number.isFinite(v.l) || !Number.isFinite(v.r)) v = { l: 0, r: measure(item, size) };
      inks.set(key, v);
    }
    return v;
  };

  // Where the baseline falls inside a line box, and how tall the capitals
  // stand on it, per em. The line box centres the font's content area, so
  // the baseline sits at half the line plus half of (ascent - descent).
  const probeBase = (voice, fb) => {
    const probe = document.createElement("div");
    probe.className = "coup-thread coup-measure";
    probe.dataset.voice = voice;
    probe.style.cssText = "font-size:100px;line-height:200px;";
    probe.textContent = "H";
    const mark = document.createElement("span");
    mark.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline;";
    probe.appendChild(mark);
    host.appendChild(probe);
    const top = mark.getBoundingClientRect().top - probe.getBoundingClientRect().top;
    probe.remove();
    return Number.isFinite(top) && top > 100 && top < 200 ? (top - 100) / 100 : fb;
  };
  const baseK = probeBase("roman", 0.36);
  const baseKSerif = probeBase("italic", baseK);
  let capK = 0.7;
  {
    pen.font = `${REST_W[0]} 100px ${family}`;
    const cap = pen.measureText("H").actualBoundingBoxAscent / 100;
    if (Number.isFinite(cap) && cap > 0.4 && cap < 1) capK = cap;
  }
  const baseOff = (size, voice) =>
    isItalic(voice) ? leadFor(voice, size) / 2 + baseKSerif * size * SERIF_SIZE : lineHeight(size) / 2 + baseK * size;

  let W = 1;
  let H = 1;
  let u = 1;
  let spread = true;

  // ---- composition -------------------------------------------------------

  // Minimum clear space between any two settled boxes, capitals included.
  const GAP_X = () => Math.max(16, 24 * u);
  const GAP_Y = () => Math.max(8, 12 * u);

  // The capitals take a new diagonal on every throw: a new thunderclap, their
  // own sizes, their own stride, still stepping down the spread left to right.
  // The diagonal the capitals sit on now; a new throw must move them.
  let lastBig = null;
  const bigDistance = (a, b) => a.reduce((sum, p, j) => sum + Math.hypot(p.x - b[j].x, p.y - b[j].y) + Math.abs(p.s - b[j].s) * 4, 0) / a.length;

  function composeBig(rng, mX, mY) {
    let best = null;
    for (let n = 0; n < 16; n++) {
      const cand = composeBigOnce(rng, mX, mY);
      if (!lastBig) return cand;
      const d = bigDistance(cand, lastBig);
      if (!best || d > best.d) best = { cand, d };
      if (d > Math.max(W, H) * 0.16) break;
    }
    return best.cand;
  }

  function composeBigOnce(rng, mX, mY) {
    const big = items.filter((it) => it.tier === 0);
    const { col, lines } = grid(mX);
    // One capital per throw is the thunderclap: it stands at about a fifth of
    // the page height and may span the whole spread. The other three step
    // down from it along the diagonal to about a third of its size, so the
    // spread has one shout and silence around it, not an even grey.
    const shout = Math.round(H * 0.22);
    const loud = Math.floor(rng() * 4);
    const sizes = big.map((_, j) => {
      if (j === loud) return 1;
      const k = Math.abs(j - loud);
      return 0.44 - k * 0.05 + (rng() - 0.5) * 0.03;
    });
    // The thunderclap gets the live width and takes the spine; the quieter
    // capitals each keep to a page, a column clear of it.
    const live = spread ? W - mX * 2 : W * 0.86;
    const pageRoom = spread ? W / 2 - mX - col : W * 0.86;
    const fit = (j, s, room) => {
      const w = measure(big[j], s);
      return Math.max(20, w > room ? Math.floor((s * room) / w) : s);
    };
    // the quiet ones are a share of the shout as it is actually set, so a
    // narrow page that shrinks the shout never lets them outgrow it
    const top = fit(loud, shout, live);
    let px = sizes.map((f, j) => (j === loud ? top : fit(j, Math.round(top * f), pageRoom)));
    // fit the four rows plus breathing room into the page height
    const avail = H - mY * 2;
    let hs = px.map(lineHeight);
    const minGap = GAP_Y() * 2;
    // shrinking keeps the ratio, so the shout stays a shout
    while (hs.reduce((a, b) => a + b, 0) + minGap * 3 > avail * 0.86 && px.some((s) => s > 20)) {
      px = px.map((s) => Math.max(20, Math.floor(s * 0.96)));
      hs = px.map(lineHeight);
    }
    const free = avail - hs.reduce((a, b) => a + b, 0) - minGap * 3;
    // top margin, three gaps, bottom margin, each a random share of the slack
    const wts = [0.2 + rng() * 0.8, 0.4 + rng() * 1.6, 0.4 + rng() * 1.6, 0.4 + rng() * 1.6, 0.2 + rng() * 0.8];
    const sum = wts.reduce((a, b) => a + b, 0);
    let y = mY + (free * wts[0]) / sum;
    const ys = [];
    for (let j = 0; j < 4; j++) {
      ys.push(snap4(y));
      y = snap4(y) + hs[j] + minGap + (j < 3 ? (free * wts[j + 1]) / sum : 0);
    }
    const ws = px.map((s, j) => measure(big[j], s));
    // stride: a start and an end on the diagonal, with uneven steps between
    const x0 = mX + rng() * W * 0.2;
    const xEnd = W - mX - ws[3] - rng() * W * 0.12;
    const steps = [0.3 + rng(), 0.3 + rng(), 0.3 + rng()];
    const stepSum = steps.reduce((a, b) => a + b, 0);
    const S = W / 2;
    let acc = 0;
    const out = [];
    let prevX = -Infinity;
    let prevInk = -Infinity;
    let centred = false;
    big.forEach((it, j) => {
      if (j > 0) acc += steps[j - 1] / stepSum;
      let x = x0 + (Math.max(x0, xEnd) - x0) * acc;
      x = Math.max(prevX + W * 0.04, x);
      x = Math.min(x, W - mX - ws[j]);
      x = Math.max(mX, x);
      prevX = x;
      // the capital's ink stands on a column line, the nearest one that
      // keeps it inside the margins
      const g = ink(it, px[j]);
      const span = g.r - g.l;
      const fits = (a) => a >= mX - 0.5 && a + span <= W - mX + 0.5;
      const onCols = lines.filter(fits);
      let a = onCols.length ? onCols.reduce((p, q) => (Math.abs(q - (x + g.l)) < Math.abs(p - (x + g.l)) ? q : p)) : Math.max(mX, Math.min(x + g.l, W - mX - span));
      // The fold: a capital either sits centred on the spine, on purpose,
      // or stands at least one column clear of it. Nothing in between.
      if (spread && a + span > S - col + 0.5 && a < S + col - 0.5) {
        // one capital at most takes the spine: it is the throw's decision,
        // and the thunderclap's, which is too wide for a page
        const opts = centred || j !== loud ? [] : [{ a: S - span / 2, centred: true }];
        // clearing it, the capital takes one of the first columns that do,
        // so the far side of the fold is not one long axis every throw
        const left = onCols.filter((q) => q + span <= S - col + 0.5);
        if (left.length) opts.push({ a: left[Math.max(0, left.length - 1 - Math.floor(rng() * 2))] });
        const right = onCols.filter((q) => q >= S + col - 0.5);
        if (right.length) opts.push({ a: right[Math.min(right.length - 1, Math.floor(rng() * 3))] });
        // taking the spine is a decision, not the nearest fix: it has to
        // win against a column's worth of doubt
        const doubt = col * (1 + rng() * 2.5);
        const cost = (o) =>
          Math.abs(o.a - a) +
          (o.centred ? doubt : 0) +
          // the diagonal steps forward; it never steps back past the last
          (o.a < prevInk - 0.5 ? W : 0);
        if (!opts.length) opts.push({ a: S - span / 2, centred: true });
        const pick = opts.reduce((p, q) => (cost(q) < cost(p) ? q : p));
        a = pick.a;
        centred = centred || !!pick.centred;
      }
      prevInk = a;
      x = a - g.l;
      out.push({ it, x, y: ys[j], s: px[j], w: ws[j], h: hs[j], ink: { l: a, r: a + span } });
    });
    return out;
  }

  // The hidden grid: fourteen columns across the live area, so on a spread
  // the spine is the seventh line and each page carries seven.
  function grid(mX) {
    const cols = 14;
    const col = (W - mX * 2) / cols;
    return { cols, col, lines: Array.from({ length: cols + 1 }, (_, k) => mX + k * col) };
  }

  function composeOnce(rng) {
    const mX = Math.round(W * 0.065);
    const mY = snap4(H * 0.09);
    const out = new Array(items.length);
    const rects = [];
    const { col, lines: colLines } = grid(mX);

    // Every capital edge a thread can share. A thread's left ink can stand
    // on a capital's left edge or start where a capital stops; its right ink
    // can hang from a capital's right edge; its first baseline can sit on a
    // capital's baseline or on its cap height, the line the tops of the
    // capitals make. Threads relate to the capitals, never to each other, so
    // the minor lines gather into constellations instead of one long column.
    const capLefts = [];
    const capRights = [];
    const capRows = [];

    for (const b of composeBig(rng, mX, mY)) {
      out[b.it.i] = { x: b.x, y: b.y, s: b.s };
      rects.push({ x: b.x, y: b.y, w: b.w, h: b.h, big: true });
      const base = b.y + baseOff(b.s);
      capLefts.push(b.ink.l, b.ink.r);
      capRights.push(b.ink.r);
      capRows.push(base, base - capK * b.s);
    }

    // The threads, shuffled, then ordered.
    const blocks = BLOCKS.map((b, bi) => ({ ...b, bi, items: items.filter((it) => it.block === bi) })).filter((b) => b.tier !== 0);
    for (let j = blocks.length - 1; j > 0; j--) {
      const k = Math.floor(rng() * (j + 1));
      [blocks[j], blocks[k]] = [blocks[k], blocks[j]];
    }
    // the longest cascade first, so it finds open water to step down before
    // the single lines take it; then the larger tier first
    blocks.sort((a, b) => b.items.length - a.items.length || a.tier - b.tier);

    const on = (v, list) => list.some((q) => Math.abs(q - v) < 0.75);
    const gutterPad = 20 * u;
    const scale = Math.min(1, Math.max(0.7, u));
    const yLo = mY * 0.6;
    let failed = 0;
    for (const blk of blocks) {
      const sizes = blk.tier === 1 ? TIER1_SIZES : TIER2_SIZES;
      const size = Math.max(10, Math.round(sizes[Math.floor(rng() * sizes.length)] * scale));
      const h = leadFor(blk.voice, size);
      const bo = baseOff(size, blk.voice);
      const many = blk.items.length > 1;
      const prefersStair = many && (blk.items.length > 3 || rng() < 0.6);
      const italic = isItalic(blk.voice);
      const g = blk.items.map((it) => ink(it, size));
      const ws = blk.items.map((it) => measure(it, size));
      // A cascade steps onto the grid: each line starts on the first column
      // line past where the one above it stopped. If that will not fit, it
      // steps on half columns; then freely; then it hangs flush; then it
      // loosens its spacing, but never below the hard clearance.
      // An italic descent is not stepped at all: each word hangs from the
      // last one's ink, its ink starting where the last one's stops, one
      // line lower, with nothing added. The words' own lengths make the fall.
      const passes = !prefersStair
        ? [["flush", 1], ["flush", 0.6], ["flush", 0]]
        : italic
          ? [["ink", 1], ["ink", 0.6], ["flush", 1], ["flush", 0.6], ["flush", 0]]
          : [["grid", 1], ["half", 1], ["stair", 1], ["flush", 1], ["flush", 0.6], ["flush", 0]];
      let best = null;
      let rel = [];
      for (const [cut, loose] of passes) {
        const stair = cut !== "flush";
        const pitch = stair && cut !== "ink" ? h + snap4(h * 0.5) : h;
        const space = size * 0.32;
        // each line's ink left, relative to the first line's
        const L = [0];
        for (let n = 1; n < blk.items.length; n++) {
          const prevR = L[n - 1] + g[n - 1].r - g[n - 1].l;
          if (cut === "grid") L.push(Math.ceil((prevR + space) / col - 1e-6) * col);
          else if (cut === "half") L.push(Math.ceil((prevR + space) / (col / 2) - 1e-6) * (col / 2));
          else if (cut === "stair") L.push(prevR + space);
          else if (cut === "ink") L.push(prevR);
          else L.push(0);
        }
        rel = blk.items.map((it, n) => ({ dx: L[n] + g[0].l - g[n].l, dy: n * pitch }));
        const bw = Math.max(...rel.map((r, n) => r.dx + ws[n]));
        const inkR = Math.max(...rel.map((r, n) => r.dx + g[n].r)) - g[0].l;
        const bh = (blk.items.length - 1) * pitch + h;
        const padY = Math.max(GAP_Y(), Math.max(16, h) * loose);
        const padX = Math.max(GAP_X(), 40 * u * loose);
        const want = (16 + rng() * 110) * u;

        // Candidates: the left ink on every column line and every edge, or
        // the right ink hung from a right edge; the first baseline on every
        // row, plus a scatter of free heights so open water stays possible.
        const xs = [...colLines, ...capLefts, ...capRights.map((r) => r - inkR)];
        for (let n = 0; n < 12 && rects.length; n++) {
          const r = rects[Math.floor(rng() * rects.length)];
          xs.push(r.x + r.w + padX * (1 + rng()));
        }
        const ys = capRows.map((b) => b - bo);
        for (let y = snap4(yLo + rng() * 8); y + bh <= H - yLo; y += 8) ys.push(y);

        let bestKey = null;
        for (const aL of xs) {
          const x = aL - g[0].l;
          if (x < mX * 0.6 || x + bw > W - mX * 0.6) continue;
          // only the capitals may cross the fold; a thread stays on its page
          if (spread && x < W / 2 + gutterPad && x + bw > W / 2 - gutterPad) continue;
          const aR = aL + inkR;
          const nX = on(aL, colLines) + on(aL, capLefts) + on(aR, capRights);
          for (const y of ys) {
            if (y < yLo || y + bh > H - yLo) continue;
            let ok = true;
            let near = Infinity;
            for (const r of rects) {
              const dx = Math.max(r.x - (x + bw), x - (r.x + r.w), 0);
              const dy = Math.max(r.y - (y + bh), y - (r.y + r.h), 0);
              if (dx < padX && dy < padY) {
                ok = false;
                break;
              }
              near = Math.min(near, Math.hypot(dx, dy));
            }
            if (!ok) continue;
            const b0 = y + bo;
            const count = nX + on(b0, capRows);
            // the most shared edges wins; whitespace only breaks a tie
            const air = Math.abs(near - want) + rng() * 10;
            if (!bestKey || count > bestKey.count || (count === bestKey.count && air < bestKey.air)) {
              bestKey = { count, air };
              best = { x, y, bw, bh };
            }
          }
        }
        if (best) break;
      }
      if (!best) failed += 1;
      blk.items.forEach((it, n) => {
        if (!best) out[it.i] = { x: -9999, y: snap4(H * 0.5), s: size, hidden: true };
        else out[it.i] = { x: best.x + rel[n].dx, y: best.y + rel[n].dy, s: size };
      });
      if (best) rects.push({ x: best.x, y: best.y, w: best.bw, h: best.bh });
    }
    return { out, failed };
  }

  function remember(out) {
    lastBig = items.filter((it) => it.tier === 0).map((it) => out[it.i]);
    return out;
  }

  // A throw that cannot seat every line is thrown again from the same seed,
  // so the poem is always whole and nothing ever lands on anything.
  function compose(rng) {
    let fallback = null;
    for (let attempt = 0; attempt < 40; attempt++) {
      const { out, failed } = composeOnce(rng);
      if (!failed) return remember(out);
      if (!fallback || failed < fallback.failed) fallback = { out, failed };
    }
    return remember(fallback.out);
  }

  // A layout is set line by line; a body takes its first line's place as
  // its own and keeps the rest as offsets in em, so they scale with it.
  function target(layout, body) {
    const head = layout[body.lines[0].i];
    const rel = body.lines.map((it) => {
      const t = layout[it.i];
      return { x: (t.x - head.x) / head.s, y: (t.y - head.y) / head.s };
    });
    return { x: head.x, y: head.y, s: head.s, rel, hidden: body.lines.some((it) => layout[it.i].hidden) };
  }

  // Where the thread's lines sit right now, in em.
  const shapeNow = (b) => b.to.map((p, n) => {
    const q = b.from[n] || p;
    return { x: q.x + (p.x - q.x) * b.m, y: q.y + (p.y - q.y) * b.m };
  });

  function place(layout) {
    for (const b of bodies) {
      const t = target(layout, b);
      b.tx = b.x = t.x;
      b.ty = b.y = t.y;
      b.ts = b.s = t.s;
      b.from = t.rel;
      b.to = t.rel;
      b.m = 1;
      b.vx = b.vy = b.vs = b.vr = b.vm = b.r = 0;
      b.next = null;
      b.hidden = t.hidden;
      b.shownM = -1;
    }
  }

  // ---- motion -----------------------------------------------------------

  let rngMotion = mulberry32(seed * 7919 + 3);
  let clock = 0;

  function toss(dirX, dirY, power) {
    seed += 1;
    const layout = compose(mulberry32(seed));
    const len = Math.hypot(dirX, dirY) || 1;
    const nx = dirX / len;
    const ny = dirY / len;
    // The capitals tumble one after another, in reading order; the threads
    // let go once the first capital is on its way. The stagger is between
    // bodies, never inside one: a thread leaves and lands as one piece.
    const blockAt = BLOCKS.map(() => 0.22 + rngMotion() * 0.36);
    for (const b of bodies) {
      const rnd = rngMotion;
      b.next = target(layout, b);
      if (b.tier === 0) {
        b.at = clock + 0.04 + b.bi * 0.15;
        b.k = 44 + b.bi * 4 + rnd() * 6;
      } else {
        b.at = clock + blockAt[b.bi];
        b.k = 72 + rnd() * 48;
      }
      const sp = power * (0.55 + rnd() * 0.9) * b.mass;
      const side = (rnd() - 0.5) * 0.9;
      b.vx += (nx - ny * side) * sp;
      b.vy += (ny + nx * side) * sp;
      // a capital turns over as it falls; a thread only rocks
      const spin = b.tier === 0 ? (rnd() < 0.5 ? -1 : 1) * (22 + rnd() * 18) : (rnd() - 0.5) * 40 * b.mass;
      b.vr += spin;
    }
    wake();
  }

  function step(dt) {
    clock += dt;
    let moving = false;
    for (const b of bodies) {
      if (b.next && clock >= b.at) {
        const t = b.next;
        b.tx = t.x;
        b.ty = t.y;
        b.ts = t.s;
        if (b.hidden && !t.hidden) {
          b.x = t.x;
          b.y = t.y;
          b.s = t.s;
          b.from = t.rel;
          b.m = 1;
        } else {
          // the shape it has now is where its re-forming starts
          b.from = shapeNow(b);
          b.m = 0;
        }
        b.vm = 0;
        b.to = t.rel;
        b.hidden = t.hidden;
        b.next = null;
      }
      const k = b.k;
      const c = 2 * Math.sqrt(k); // critically damped: no overshoot
      b.vx += (-k * (b.x - b.tx) - c * b.vx) * dt;
      b.vy += (-k * (b.y - b.ty) - c * b.vy) * dt;
      b.vs += (-k * (b.s - b.ts) - c * b.vs) * dt;
      // the thread re-forms on the body's own spring, so its shape arrives
      // with it and never on a clock of its own
      b.vm += (-k * (b.m - 1) - c * b.vm) * dt;
      const kr = k * 1.6;
      // a capital leans into its flight and rights itself as it arrives
      const rT = b.tier === 0 ? Math.max(-6, Math.min(6, ((b.x - b.tx) / W) * 14 + ((b.ty - b.y) / H) * 4)) : 0;
      b.vr += (-kr * (b.r - rT) - 2 * Math.sqrt(kr) * b.vr) * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.s += b.vs * dt;
      b.m = Math.min(1, b.m + b.vm * dt);
      b.r += b.vr * dt;
      const off = Math.abs(b.x - b.tx) + Math.abs(b.y - b.ty) + Math.abs(b.s - b.ts) * 4 + Math.abs(b.r) * 20 + (1 - b.m) * 40;
      const vel = Math.abs(b.vx) + Math.abs(b.vy) + Math.abs(b.vs) + Math.abs(b.vr);
      if (b.next || off > 0.08 || vel > 0.5) moving = true;
      else {
        b.x = b.tx;
        b.y = b.ty;
        b.s = b.ts;
        b.r = 0;
        b.m = 1;
        b.vx = b.vy = b.vs = b.vr = b.vm = 0;
      }
    }
    return moving;
  }

  function render() {
    for (const b of bodies) {
      const el = b.el;
      if (b.hidden) {
        el.style.visibility = "hidden";
        continue;
      }
      el.style.visibility = "";
      const s = Math.max(6, b.s);
      if (Math.abs(s - b.shown) > 0.01) {
        b.shown = s;
        el.style.fontSize = `${s.toFixed(2)}px`;
        el.style.letterSpacing = trackingFor(b.voice, s);
        el.style.lineHeight = `${leadFor(b.voice, s)}px`;
        if (b.tier === 2 && s <= 13.5) el.dataset.small = "";
        else delete el.dataset.small;
      }
      if (b.m !== b.shownM) {
        b.shownM = b.m;
        shapeNow(b).forEach((p, n) => {
          const ls = b.lines[n].el.style;
          ls.left = `${p.x.toFixed(4)}em`;
          ls.top = `${p.y.toFixed(4)}em`;
        });
      }
      const d = Math.hypot(b.x - b.tx, b.y - b.ty) + Math.abs(b.s - b.ts) * 3;
      const v = Math.hypot(b.vx, b.vy);
      let f = Math.min(1, Math.max(d / (110 * Math.max(0.6, u)), v / (520 * Math.max(0.6, u))));
      f = f * f * (3 - 2 * f);
      // the italic is already the light cut; only the roman thins in flight
      if (b.tier < 2 && !isItalic(b.voice)) {
        const w = Math.round(REST_W[b.tier] - (REST_W[b.tier] - FLIGHT_W) * f);
        if (w !== b.shownW) {
          b.shownW = w;
          el.style.fontWeight = w === REST_W[b.tier] ? "" : String(w);
        }
      }
      // Stacking is the only depth there is: a landed thread lies above any
      // thread still in the air, and a capital above a thread of its state.
      // Each line is an opaque slip, so the one beneath is simply covered.
      const z = (f < 0.08 ? 4 : 1) + (b.tier === 0 ? 1 : 0);
      if (z !== b.shownZ) {
        b.shownZ = z;
        el.style.zIndex = String(z);
      }
      const lim = b.tier === 0 ? 7 : 2.2;
      const r = Math.max(-lim, Math.min(lim, b.r));
      el.style.transform = `translate3d(${b.x.toFixed(2)}px, ${b.y.toFixed(2)}px, 0) rotate(${r.toFixed(3)}deg)`;
    }
  }

  let raf = 0;
  let last = 0;
  let destroyed = false;
  function frame(now) {
    raf = 0;
    if (destroyed) return;
    const dt = Math.min(1 / 30, Math.max(1 / 240, (now - last) / 1000));
    last = now;
    // fixed substeps keep the springs stable at any frame rate
    const n = Math.ceil(dt / (1 / 240));
    let moving = false;
    for (let i = 0; i < n; i++) moving = step(dt / n) || moving;
    render();
    if (moving) raf = requestAnimationFrame(frame);
  }
  function wake() {
    if (freezeT != null || destroyed) return;
    if (reduced) {
      for (const b of bodies) if (b.next) b.at = clock;
      step(0);
      for (const b of bodies) {
        b.x = b.tx; b.y = b.ty; b.s = b.ts; b.r = 0; b.m = 1;
        b.vx = b.vy = b.vs = b.vr = b.vm = 0;
      }
      render();
      return;
    }
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }

  // ---- input -----------------------------------------------------------

  let px = null;
  let py = null;
  let lastT = 0;
  let travel = 0;
  let sumX = 0;
  let sumY = 0;
  let downAt = null;
  let speed = 0;

  const local = (e) => {
    const r = host.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const onMove = (e) => {
    if (freezeT != null) return;
    const [x, y] = local(e);
    const now = performance.now();
    if (px == null || now - lastT > 220) {
      // a new gesture
      px = x;
      py = y;
      lastT = now;
      travel = 0;
      sumX = sumY = 0;
      return;
    }
    const dx = x - px;
    const dy = y - py;
    const dtm = Math.max(1, now - lastT);
    speed += (Math.hypot(dx, dy) / dtm * 1000 - speed) * Math.min(1, dtm / 50);
    px = x;
    py = y;
    lastT = now;
    travel += Math.hypot(dx, dy);
    sumX += dx;
    sumY += dy;

    // the hand passing over the lines jostles them
    const sigma = Math.max(W, H) * 0.2;
    const gain = Math.min(1, speed / 1400) * 9;
    let touched = false;
    for (const b of bodies) {
      if (b.hidden) continue;
      const size = Math.round(b.ts);
      const w = Math.max(...b.lines.map((it, n) => b.to[n].x * b.s + measure(it, size)));
      const h = (b.to[b.to.length - 1]?.y || 0) * b.s + leadFor(b.voice, b.s);
      const cx = b.x + w / 2;
      const cy = b.y + h / 2;
      const d2 = (cx - x) ** 2 + (cy - y) ** 2;
      const f = Math.exp(-d2 / (2 * sigma * sigma));
      if (f < 0.02) continue;
      b.vx += dx * gain * f * b.mass;
      b.vy += dy * gain * f * b.mass;
      b.vr += ((x - cx) * dy - (y - cy) * dx) / (w + 40) * 0.6 * f * b.mass * Math.min(1, speed / 900);
      touched = true;
    }
    if (touched) wake();

    // enough of a sweep is a throw; a long sweep throws again
    const need = W * (downAt ? 0.1 : 0.16);
    if (travel > need && speed > 500) {
      travel = -W * 0.35;
      toss(sumX, sumY, Math.min(900, speed * 0.55) * Math.max(0.6, u));
      sumX = sumY = 0;
    }
  };

  const onDown = (e) => {
    if (freezeT != null) return;
    const [x, y] = local(e);
    downAt = { x, y, t: performance.now() };
    host.setPointerCapture?.(e.pointerId);
  };
  const onUp = (e) => {
    if (freezeT != null || !downAt) return;
    const [x, y] = local(e);
    const moved = Math.hypot(x - downAt.x, y - downAt.y);
    if (moved < 6 && performance.now() - downAt.t < 400) {
      // a tap is a throw from where you tapped, outward
      toss(W / 2 - x || 1, H / 2 - y || 1, 420 * Math.max(0.6, u));
    }
    downAt = null;
  };

  host.addEventListener("pointermove", onMove);
  host.addEventListener("pointerdown", onDown);
  host.addEventListener("pointerup", onUp);
  host.addEventListener("pointercancel", onUp);

  // ---- size ------------------------------------------------------------

  let sized = false;
  const resize = () => {
    const r = box.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width));
    H = Math.max(1, Math.round(r.height));
    spread = W / H > 1.05 && W > 640;
    u = spread ? Math.min(W / 1280, H / 800) : Math.min(1, W / 600, H / 800);
    gutter.style.display = spread ? "" : "none";
    widths.clear();
    for (const b of bodies) b.shown = -1;
    if (freezeT != null) seed = baseSeed;
    lastBig = null;
    place(compose(mulberry32(seed)));
    if (freezeT != null) {
      rngMotion = mulberry32(seed * 7919 + 3);
      clock = 0;
      toss(1, 0.35, 760 * Math.max(0.6, u));
      const dt = 1 / 240;
      for (let t = 0; t < freezeT; t += dt) step(dt);
    }
    render();
    if (freezeT != null) window.__coupOverlaps = overlaps(0, 0);
    sized = true;
  };

  // Every pair of visible line boxes, read back from the DOM, closer than
  // the given clearance. Used by ?audit and by the frozen still.
  function overlaps(mx, my) {
    const hr = host.getBoundingClientRect();
    const boxes = items
      .filter((it) => !it.body.hidden)
      .map((it) => {
        const r = it.el.getBoundingClientRect();
        return { t: it.text, blk: it.block, x: r.left - hr.left, y: r.top - hr.top, w: r.width, h: r.height };
      });
    const hits = [];
    for (let a = 0; a < boxes.length; a++) {
      for (let b = a + 1; b < boxes.length; b++) {
        const A = boxes[a];
        const B = boxes[b];
        const gx = Math.max(B.x - (A.x + A.w), A.x - (B.x + B.w));
        const gy = Math.max(B.y - (A.y + A.h), A.y - (B.y + B.h));
        // lines of one thread are set solid against each other; they may
        // touch but never overlap
        const same = A.blk === B.blk;
        if (same ? gx < -0.5 && gy < -0.5 : gx < mx && gy < my) hits.push(`${A.t} × ${B.t}`);
      }
    }
    return { hits, boxes };
  }


  const ro = new ResizeObserver(resize);
  ro.observe(box);
  resize();
  if (params.has("audit")) {
    const n = parseInt(params.get("audit"), 10) || 50;
    const report = [];
    for (let k = 0; k < n; k++) {
      const before = lastBig;
      place(compose(mulberry32(baseSeed + k)));
      const moved = before ? Math.round(bigDistance(lastBig, before)) : 0;
      render();
      const { hits, boxes } = overlaps(12, 8);
      const out = boxes.filter((b) => b.x < 0 || b.y < 0 || b.x + b.w > W || b.y + b.h > H).map((b) => b.t);
      const big = bodies.filter((b) => b.tier === 0).map((b) => [Math.round(b.x), Math.round(b.y), Math.round(b.s)]);
      // each capital against the fold: centred on it, clear of it by a
      // column, or (never) somewhere in between
      const mX = Math.round(W * 0.065);
      const { col } = grid(mX);
      const fold = !spread
        ? []
        : bodies
            .filter((b) => b.tier === 0)
            .map((b) => {
              const g = ink(b.lines[0], b.ts);
              const l = b.x + g.l;
              const r = b.x + g.r;
              if (Math.abs((l + r) / 2 - W / 2) < 1) return "centre";
              return r <= W / 2 - col + 1 || l >= W / 2 + col - 1 ? "clear" : "near";
            });
      report.push({ seed: baseSeed + k, hits, out, hidden: bodies.filter((b) => b.hidden).length, big, moved, fold });
    }
    window.__coupAudit = report;
  }
  void sized;
  void embedded;

  return {
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointerup", onUp);
      host.removeEventListener("pointercancel", onUp);
      host.replaceChildren();
    },
  };
}
