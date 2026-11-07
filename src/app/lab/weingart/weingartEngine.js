// Weingart: a song credit set as a forme of metal type. Every line is a row
// of sorts, single pieces of lead, that move only in whole diagonal steps
// along a chase. Neighbouring sorts sit level or one step apart, never
// more: push a sort down and each sort ahead of it drops one step below the
// one before, while the ones behind trail a step each, so a pushed line
// breaks into a stepped staircase. Tracking between sorts never changes;
// only the sorts move. Sorts of the same ink are solid bodies: a staircase
// that comes down onto a neighbouring line shoves just the sorts it lands
// on, which breaks that line into its own staircase, and so on down the
// chain, until something meets the chase and the whole run locks. Only the
// red run, printed in a second pass, crosses the black, and where it does
// the two inks make a third.
// ?t=0..1 holds a still of "Here" pushed down through the forme.
import { createStage, clamp } from "../_kit/stage";

// Design space the forme is composed in, fitted into the piece box.
const DW = 1000;
const DH = 600;
// One step in the chase: right and down, 2:1.
const SX = 24;
const SY = 12;
// How far a line can be dragged either way, in steps.
const D_MAX = 48;
// Below this size a line is set in word slugs, not single letters: a 13px
// letter stepped 24px apart is no longer a word.
const LETTER_MIN = 40;
// Lead between two bodies that touch, design px.
const GAP = 8;
// Body above and below a rule's face, so it never sits on a baseline as an underline.
const RULE_LEAD = 6;
// Seconds between neighbouring sorts seating, left to right; and between links of a chain.
const STAGGER = 0.034;
const STAGGER_HELD = 0.014;
const LINK = 0.06;

const PAPER = "#f7f6f2";
const BLACK = "#141414";
const RED = "#e3402a";
// Black printed over red: not flat multiply but a third, darker ink.
const OVER = "#561a12";

const law = (size) => -0.043 * (size - 12);

// The forme. x, y are the baseline-left (or rule top-left) of each line as composed.
const FORME = [
  { text: "The Beatles", size: 20, w: "strong", x: 4, y: 52 },
  { text: "3:05", size: 244, w: "semibold", ink: "red", x: 476, y: 476 },
  { text: "Here", size: 108, w: "semibold", x: 0, y: 168 },
  { text: "Comes", size: 108, w: "semibold", x: 48, y: 264 },
  { text: "the Sun", size: 108, w: "semibold", x: 96, y: 360 },
  // The rule is made up from brass pieces of the lengths a case actually holds.
  { rule: true, pieces: [144, 72, 96, 48, 120, 96], thick: 12, x: 0, y: 392 },
  { text: "Written by George Harrison", size: 13, w: "strong", rev: true, x: 216, y: 436 },
  { text: "Abbey Road", size: 20, w: "strong", x: 652, y: 92 },
  { text: "Side two, track one", size: 13, w: "body", x: 676, y: 116 },
  { text: "Apple Records", size: 13, w: "body", x: 700, y: 136 },
  { text: "London, 26 September 1969", size: 13, w: "body", x: 724, y: 156 },
];

export async function createWeingart(host) {
  const stage = createStage(host, { dpr: 2 });
  const { ctx, canvas } = stage;
  const params = new URLSearchParams(window.location.search);
  const stillT = params.has("t") ? clamp(parseFloat(params.get("t")) || 0, 0, 1) : null;

  const cs = getComputedStyle(document.documentElement);
  const sans = cs.getPropertyValue("--font-sans").trim() || "system-ui, sans-serif";
  const weight = {
    semibold: cs.getPropertyValue("--font-weight-semibold").trim() || "600",
    strong: cs.getPropertyValue("--font-weight-strong").trim() || "590",
    caption: cs.getPropertyValue("--font-weight-caption").trim() || "520",
    body: cs.getPropertyValue("--font-weight-body-sm").trim() || "490",
  };
  try {
    await Promise.all(Object.values(weight).map((w) => document.fonts.load(`${w} 40px ${sans}`)));
  } catch {
    /* draw with whatever is loaded */
  }

  let held = null;

  const slugs = FORME.map((d, i) => ({
    ...d,
    id: i,
    vec: null,
    nudge: 0,
    layer: d.ink === "red" ? "red" : "black",
    font: d.rule ? null : `${weight[d.w]} ${d.size}px ${sans}`,
    kind: d.rule ? "rule" : d.size >= LETTER_MIN ? "letter" : "word",
    cx: null,
    units: [],
  }));

  // Cut each line into its sorts. Prefix advances keep the font's own
  // kerning; the law's tracking is added once per letter and never changes.
  const sort = (x, w, extra) => ({ x, w, p: 0, v: 0, k: 0, q: 0, wait: 0, seat: 0, settled: true, vis: true, ...extra });
  const cut = () => {
    for (const s of slugs) {
      if (s.rule) {
        let at = 0;
        s.units = s.pieces.map((w) => sort((at += w) - w, w));
        continue;
      }
      ctx.font = s.font;
      const t = law(s.size);
      const n = s.text.length;
      s.cx = [];
      for (let i = 0; i < n; i++) s.cx.push(ctx.measureText(s.text.slice(0, i)).width + i * t);
      s.cx.push(ctx.measureText(s.text).width + (n - 1) * t);
      s.units = [];
      if (s.kind === "letter") {
        for (let i = 0; i < n; i++) {
          const ch = s.text[i];
          s.units.push(sort(s.cx[i], s.cx[i + 1] - s.cx[i], { i0: i, i1: i + 1, vis: ch !== " ", desc: /[gjpqy,]/.test(ch) }));
        }
      } else {
        for (const m of s.text.matchAll(/\S+\s*/g)) {
          const i0 = m.index;
          const i1 = i0 + m[0].trimEnd().length;
          // A reversed slug's word carries its space, so the solid ground is unbroken at rest.
          const end = s.rev ? i0 + m[0].length : i1;
          s.units.push(sort(s.cx[i0], s.cx[end] - s.cx[i0], { i0, i1, desc: /[gjpqy,]/.test(m[0]) }));
        }
      }
      s.units[0].first = true;
      s.units[s.units.length - 1].last = true;
    }
    for (const s of slugs) s.vec = s.units.map(() => 0);
  };
  cut();

  // A line's state is one whole step per sort, counted from where it was
  // composed. Push sort j one step (dir): the sorts ahead of it that would
  // end up above it are shoved along, and the sorts behind it trail so no
  // two neighbours are ever more than one step apart. Pushed by its tail a
  // line opens into a staircase; pushed by its head it travels as one.
  const shove = (v, j, dir) => {
    v[j] += dir;
    if (dir > 0) {
      // Driven down, a sort drives each sort ahead of it one step lower than the one before.
      for (let i = j + 1; i < v.length; i++) v[i] = Math.max(v[i], v[i - 1] + 1);
      for (let i = j - 1; i >= 0; i--) v[i] = Math.max(v[i], v[i + 1] - 1);
    } else {
      for (let i = j + 1; i < v.length; i++) v[i] = Math.min(v[i], v[i - 1] + 1);
      for (let i = j - 1; i >= 0; i--) v[i] = Math.min(v[i], v[i + 1]);
    }
    return v;
  };
  // A line dragged d steps from base by its sort j.
  const dragged = (base, j, d) => {
    const v = base.slice();
    for (let i = 0; i < Math.abs(d); i++) shove(v, j, Math.sign(d));
    return v;
  };

  // One sort's body in design space at offset o steps.
  const unitRect = (s, u, o) => {
    const x = s.x + u.x + o * SX;
    const y = s.y + o * SY;
    if (s.rule) return { x, y: y - RULE_LEAD, w: u.w, h: s.thick + RULE_LEAD * 2 };
    if (s.rev) {
      const l = u.first ? 10 : 0;
      return { x: x - l, y: y - 17, w: u.w + l + (u.last ? 10 : 0), h: 24 };
    }
    const desc = u.desc ? s.size * 0.2 : 0;
    return { x, y: y - s.size * 0.74, w: Math.max(u.w, s.size * 0.3), h: s.size * 0.74 + desc };
  };
  const rectsAt = (s, v) => {
    const out = [];
    s.units.forEach((u, j) => u.vis && out.push({ ...unitRect(s, u, v[j]), j }));
    return out;
  };
  const rectsNow = (s) => {
    const out = [];
    s.units.forEach((u, j) => u.vis && out.push({ ...unitRect(s, u, u.p), j }));
    return out;
  };
  const union = (rs) => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const r of rs) {
      x0 = Math.min(x0, r.x);
      y0 = Math.min(y0, r.y);
      x1 = Math.max(x1, r.x + r.w);
      y1 = Math.max(y1, r.y + r.h);
    }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  };

  const touches = (a, b) =>
    a.x < b.x + b.w + GAP && b.x < a.x + a.w + GAP && a.y < b.y + b.h + GAP && b.y < a.y + a.h + GAP;
  // Two lines touch if any sort of one touches any sort of the other.
  const touchesAny = (A, B) => {
    if (!touches(union(A), union(B))) return false;
    for (const a of A) for (const b of B) if (touches(a, b)) return true;
    return false;
  };

  // The chase, in design space; set on resize.
  let chase = { lo: -1e9, hi: 1e9, top: -1e9, bot: 1e9 };
  const fits = (s, v) => {
    const r = union(rectsAt(s, v));
    return r.x >= chase.lo && r.x + r.w <= chase.hi && r.y >= chase.top && r.y + r.h <= chase.bot;
  };

  // Plan moving line s to state vec, every sort having moved in dir. Any
  // line of the same ink that a moving sort would touch has exactly the
  // sorts that are hit shoved ahead, a step at a time, until it clears;
  // each shoved line pushes on in turn. If anything in the chain would have
  // to leave the chase the move is refused: the run is locked up. Returns
  // the new state and chain depth of every line that moves, or null.
  const plan = (s, vec, dir) => {
    const next = new Map([[s, { v: vec, depth: 0 }]]);
    const queue = [{ a: s, depth: 0 }];
    const stateOf = (o) => (next.has(o) ? next.get(o).v : o.vec);
    let guard = 0;
    while (queue.length) {
      if (++guard > 600) return null;
      const { a, depth } = queue.shift();
      if (!fits(a, stateOf(a))) return null;
      const ra = rectsAt(a, stateOf(a));
      const ua = union(ra);
      for (const o of slugs) {
        if (o === a || o.layer !== a.layer) continue;
        const v0 = stateOf(o);
        if (!touchesAny(ra, rectsAt(o, v0))) continue;
        // A body behind the push can never be cleared by shoving it on.
        if (o === s) return null;
        const vo = v0.slice();
        // One sort at a time, the one furthest along the line first, so a
        // shoved line moves no more than it has to.
        for (let n = 0; ; n++) {
          let j = -1;
          for (const r of rectsAt(o, vo)) {
            if (r.j > j && touches(ua, r) && ra.some((q) => touches(q, r))) j = r.j;
          }
          if (j < 0) break;
          shove(vo, j, dir);
          if (n > 200 || !fits(o, vo)) return null;
        }
        next.set(o, { v: vo, depth: Math.max(next.get(o)?.depth ?? 0, depth + 1) });
        queue.push({ a: o, depth: depth + 1 });
      }
    }
    // Whatever moved must end clear of every other body of its ink.
    for (const [m, { v }] of next) {
      const rm = rectsAt(m, v);
      for (const o of slugs) {
        if (o !== m && o.layer === m.layer && touchesAny(rm, rectsAt(o, stateOf(o)))) return null;
      }
    }
    return next;
  };

  // Set line s to state vec. Each sort whose step changes is queued to go,
  // left to right, a beat apart, so a line breaks and seats sort by sort; a
  // shoved line waits for the link of the chain before it. animate=false
  // seats everything at once (for the still).
  const setVec = (s, vec, animate, depth = 0) => {
    s.vec = vec;
    const stagger = s === held ? STAGGER_HELD : STAGGER;
    s.units.forEach((u, j) => {
      if (!animate) {
        u.p = u.k = u.q = vec[j];
        u.v = 0;
        u.wait = 0;
        u.settled = true;
        return;
      }
      if (vec[j] === u.q) return;
      u.q = vec[j];
      u.settled = false;
      // Already queued: keep its place in the sequence, it takes the newest step when it goes.
      if (u.wait <= 0) u.wait = depth * LINK + j * stagger + 1e-6;
    });
  };

  // Drag s, held by sort j from state base, toward d steps, one step at a
  // time; stops where the chain locks. Returns the step reached, how many
  // steps it made and how long the longest chain was.
  const drag = (s, base, j, from, d, animate) => {
    let at = from;
    let steps = 0;
    let deepest = 0;
    while (at !== d) {
      const dir = Math.sign(d - at);
      const pl = plan(s, dragged(base, j, at + dir), dir);
      if (!pl) return { at, steps, deepest, locked: true };
      for (const [o, { v, depth }] of pl) {
        deepest = Math.max(deepest, depth);
        setVec(o, v, animate, depth);
      }
      at += dir;
      steps++;
    }
    return { at, steps, deepest, locked: false };
  };

  // Fit the forme to the box.
  let scale = 1;
  let ox = 0;
  let oy = 0;
  let W = 1;
  let H = 1;
  let dpr = 1;
  // A sheet for cutting the reversed slug, and one for the third ink.
  const off = document.createElement("canvas");
  const octx = off.getContext("2d");
  const ovc = document.createElement("canvas");
  const ov = ovc.getContext("2d");
  let grain = null;
  let dirty = true;

  const makeGrain = () => {
    // In device pixels, so a fleck is a couple of pixels across at any DPR
    // and actually reads as ink that did not take, not as sensor noise.
    const n = 256;
    const c = document.createElement("canvas");
    c.width = c.height = n;
    const g = c.getContext("2d");
    const u = Math.max(1, Math.round(dpr));
    for (let i = 0; i < 900; i++) {
      const big = Math.random() < 0.12;
      g.fillStyle = `rgba(255,255,255,${big ? 0.55 + Math.random() * 0.35 : 0.18 + Math.random() * 0.22})`;
      const w = u * (big ? 1 + Math.random() * 1.6 : 0.6 + Math.random() * 0.8);
      const h = u * (big ? 0.8 + Math.random() * 1.2 : 0.6 + Math.random() * 0.6);
      g.fillRect(Math.random() * n, Math.random() * n, w, h);
    }
    return ctx.createPattern(c, "repeat");
  };

  const limits = () => {
    const m = 12 / scale;
    chase = { lo: -ox / scale + m, hi: (W - ox) / scale - m, top: -oy / scale + m, bot: (H - oy) / scale - m };
  };

  // Still: from the composed forme, push "Here" down the chase by its last
  // sort and let it shove everything below it. t is the fraction of the way
  // to where the whole run locks against the chase; t=1 is locked solid.
  const applyStill = () => {
    const here = slugs.find((s) => s.text === "Here");
    const tail = here.units.length - 1;
    const reset = () => {
      for (const s of slugs) setVec(s, s.units.map(() => 0), false);
      limits();
    };
    reset();
    const all = drag(here, here.vec, tail, 0, D_MAX, false).steps;
    reset();
    drag(here, here.vec, tail, 0, Math.round(stillT * all), false);
  };

  stage.onResize((w, h, d) => {
    W = w;
    H = h;
    dpr = d;
    off.width = canvas.width;
    off.height = canvas.height;
    ovc.width = canvas.width;
    ovc.height = canvas.height;
    const pad = Math.max(16, Math.min(w, h) * 0.08);
    scale = Math.min((w - pad * 2) / DW, (h - pad * 2) / DH, 1.25);
    // Sit a little left of centre and a little high: an asymmetric forme.
    ox = (w - DW * scale) * 0.44;
    oy = (h - DH * scale) * 0.46;
    grain = makeGrain();
    if (stillT != null) applyStill();
    else limits();
    dirty = true;
  });

  /* ---------- sound: a small tick of lead per step, a knock per sort seated ---------- */
  let ac = null;
  let noise = null;
  const audio = () => {
    if (ac) return;
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      noise = ac.createBuffer(1, Math.round(ac.sampleRate * 0.05), ac.sampleRate);
      const ch = noise.getChannelData(0);
      for (let i = 0; i < ch.length; i++) ch[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ac.sampleRate * 0.006));
    } catch {
      ac = null;
    }
  };
  const click = (freq, gain, q = 2.5, at = 0) => {
    if (!ac) return;
    const t = Math.max(ac.currentTime, at);
    const src = ac.createBufferSource();
    src.buffer = noise;
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq * (0.94 + Math.random() * 0.12);
    bp.Q.value = q;
    const g = ac.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(bp).connect(g).connect(ac.destination);
    src.start(t);
  };
  // Sorts seating close together still knock one at a time, a short patter;
  // a backlog longer than a beat is dropped rather than played late.
  let knockAt = 0;
  const knock = (j) => {
    if (!ac) return;
    const t = Math.max(ac.currentTime, knockAt);
    if (t - ac.currentTime > 0.3) return;
    click(1300 + (j % 5) * 70, 0.07, 1.4, t);
    knockAt = t + 0.024;
  };

  /* ---------- input ---------- */
  const toDesign = (x, y) => [(x - ox) / scale, (y - oy) / scale];
  const hit = (x, y) => {
    const [dx, dy] = toDesign(x, y);
    const pad = 8 / scale;
    for (let i = slugs.length - 1; i >= 0; i--) {
      const s = slugs[i];
      const py = s.rule ? Math.max(pad, 10 / scale) : pad;
      for (const r of rectsNow(s)) {
        if (dx >= r.x - pad && dx <= r.x + r.w + pad && dy >= r.y - py && dy <= r.y + r.h + py) return { s, j: r.j };
      }
    }
    return null;
  };

  const DIR = [SX / Math.hypot(SX, SY), SY / Math.hypot(SX, SY)];
  const STEP = Math.hypot(SX, SY);
  let grab = null;

  stage.on("down", (p) => {
    const h = hit(p.x, p.y);
    if (!h) return;
    const { s } = h;
    audio();
    ac?.resume?.();
    held = s;
    // Picked slug goes to the top of the forme.
    slugs.splice(slugs.indexOf(s), 1);
    slugs.push(s);
    // Held by the sort under the hand: what is ahead of it is pushed, what
    // is behind it trails into a staircase.
    grab = { x: p.x, y: p.y, base: s.vec.slice(), j: h.j, d: 0 };
    s.lockedAt = false;
    canvas.style.cursor = "grabbing";
  });

  stage.on("move", (p) => {
    if (!held) {
      canvas.style.cursor = hit(p.x, p.y) ? "grab" : "";
      return;
    }
    const dx = (p.x - grab.x) / scale;
    const dy = (p.y - grab.y) / scale;
    const r = (dx * DIR[0] + dy * DIR[1]) / STEP;
    const want = clamp(Math.round(r), -D_MAX, D_MAX);
    let locked = false;
    if (want !== grab.d) {
      const from = grab.d;
      const res = drag(held, grab.base, grab.j, grab.d, want, true);
      grab.d = res.at;
      locked = res.locked;
      // Several steps in one move still tick once each; a shoved run knocks
      // lower and longer, one knock per link of the chain.
      const n = Math.min(4, Math.abs(grab.d - from));
      for (let i = 0; i < n; i++) setTimeout(() => click(3400, 0.05), i * 18);
      for (let i = 1; i <= Math.min(5, res.deepest); i++) setTimeout(() => click(2100 - i * 160, 0.045), i * 45);
      if (res.locked && !held.lockedAt) click(700, 0.12, 1.2);
    }
    held.lockedAt = locked;
    // A little of the remaining pull shows, like lead resisting the next step;
    // against a locked run it barely gives.
    const rest = clamp(r - grab.d, -0.5, 0.5);
    held.nudge = rest * 0.16 * (locked ? 0.25 : 1);
    for (const u of held.units) u.settled = false;
  });

  stage.on("up", () => {
    if (!held) return;
    held.nudge = 0;
    for (const u of held.units) u.settled = false;
    held = null;
    canvas.style.cursor = "grab";
  });

  /* ---------- draw ---------- */
  const density = (s, u) => Math.min(1, (s.layer === "red" ? 0.93 : 0.95) + u.seat * 0.05);

  // Each sort printed where it sits. With dens, each sort carries its own
  // ink density (a fresh knock prints a touch darker).
  const drawSlug = (g, s, inkStyle, dens = false) => {
    g.fillStyle = inkStyle;
    const a0 = g.globalAlpha;
    if (s.rule) {
      // Pieces sitting on the same step abut into one run of rule, drawn as
      // one rect so the joins never show as seams.
      let j = 0;
      while (j < s.units.length) {
        const u = s.units[j];
        let e = j + 1;
        while (e < s.units.length && Math.abs(s.units[e].p - u.p) < 1e-3) e++;
        const r = unitRect(s, u, u.p);
        const last = s.units[e - 1];
        if (dens) g.globalAlpha = a0 * density(s, u);
        g.fillRect(r.x, r.y + RULE_LEAD, last.x + last.w - u.x, s.thick);
        j = e;
      }
      g.globalAlpha = a0;
      return;
    }
    g.font = s.font;
    g.textBaseline = "alphabetic";
    for (const u of s.units) {
      if (!u.vis) continue;
      if (dens) g.globalAlpha = a0 * density(s, u);
      // The knock: a sort just seated sits a hair deep for a moment.
      const x = s.x + u.p * SX;
      const y = s.y + u.p * SY + u.seat * u.seat * 0.8;
      for (let i = u.i0; i < u.i1; i++) {
        const ch = s.text[i];
        if (ch !== " ") g.fillText(ch, x + s.cx[i], y);
      }
    }
    g.globalAlpha = a0;
  };

  // A design-space rect as a whole-pixel device rect, clipped to the canvas.
  const devRect = (r, pad) => {
    const x0 = Math.max(0, Math.floor((ox + (r.x - pad) * scale) * dpr));
    const y0 = Math.max(0, Math.floor((oy + (r.y - pad) * scale) * dpr));
    const x1 = Math.min(canvas.width, Math.ceil((ox + (r.x + r.w + pad) * scale) * dpr));
    const y1 = Math.min(canvas.height, Math.ceil((oy + (r.y + r.h + pad) * scale) * dpr));
    return { x: x0, y: y0, w: Math.max(0, x1 - x0), h: Math.max(0, y1 - y0) };
  };
  const toForme = (g) => g.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy);
  const slugDensity = (s) => Math.max(...s.units.map((u) => density(s, u)));

  // The reversed slug is solid ink with its letters cut out, one block per
  // sort. drawRev paints it into g as is; on the paper it is cut on its own
  // sheet first, so the knockout shows whatever is printed under it.
  const drawRev = (g, s) => {
    g.fillStyle = BLACK;
    for (const u of s.units) {
      const r = unitRect(s, u, u.p);
      g.fillRect(r.x, r.y, r.w, r.h);
    }
    const op = g.globalCompositeOperation;
    g.globalCompositeOperation = "destination-out";
    drawSlug(g, s, "#000");
    g.globalCompositeOperation = op;
  };

  const draw = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Red run first, then black over it; inks multiply into the paper.
    ctx.globalCompositeOperation = "multiply";
    for (const layer of ["red", "black"]) {
      for (const s of slugs) {
        if (s.layer !== layer) continue;
        if (!s.rev) {
          ctx.globalAlpha = 1;
          toForme(ctx);
          drawSlug(ctx, s, layer === "red" ? RED : BLACK, true);
          continue;
        }
        ctx.globalAlpha = slugDensity(s);
        const d = devRect(union(rectsNow(s)), 4);
        if (!d.w || !d.h) continue;
        octx.setTransform(1, 0, 0, 1, 0, 0);
        octx.globalCompositeOperation = "source-over";
        octx.globalAlpha = 1;
        octx.clearRect(d.x, d.y, d.w, d.h);
        toForme(octx);
        drawRev(octx, s);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.drawImage(off, d.x, d.y, d.w, d.h, d.x, d.y, d.w, d.h);
      }
    }

    // Where black lands on red the two inks make a third. Inside each red
    // slug's box: the black coverage, kept only where red is printed, then
    // filled with the dark ink and laid over the top.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    for (const red of slugs) {
      if (red.layer !== "red") continue;
      const rr = rectsNow(red);
      const rb = union(rr);
      const d = devRect(rb, red.size ? red.size * 0.12 : 4);
      if (!d.w || !d.h) continue;
      ov.setTransform(1, 0, 0, 1, 0, 0);
      ov.globalCompositeOperation = "source-over";
      ov.globalAlpha = 1;
      ov.clearRect(d.x, d.y, d.w, d.h);
      ov.save();
      ov.beginPath();
      ov.rect(d.x, d.y, d.w, d.h);
      ov.clip();
      toForme(ov);
      let any = false;
      for (const s of slugs) {
        if (s.layer !== "black" || !touchesAny([rb], rectsNow(s))) continue;
        any = true;
        ov.globalAlpha = 1;
        if (s.rev) {
          ov.globalAlpha = slugDensity(s);
          drawRev(ov, s);
        } else drawSlug(ov, s, BLACK, true);
      }
      ov.restore();
      if (any) {
        // The red coverage as one image, so a single destination-in keeps
        // exactly the black that sits on red (per-glyph draws would not).
        octx.setTransform(1, 0, 0, 1, 0, 0);
        octx.globalCompositeOperation = "source-over";
        octx.globalAlpha = 1;
        octx.clearRect(d.x, d.y, d.w, d.h);
        toForme(octx);
        drawSlug(octx, red, RED, true);
        octx.globalAlpha = 1;
        ov.setTransform(1, 0, 0, 1, 0, 0);
        ov.globalAlpha = 1;
        ov.globalCompositeOperation = "destination-in";
        ov.drawImage(off, d.x, d.y, d.w, d.h, d.x, d.y, d.w, d.h);
        ov.globalCompositeOperation = "source-in";
        ov.fillStyle = OVER;
        ov.fillRect(d.x, d.y, d.w, d.h);
        ov.globalCompositeOperation = "source-over";
        ctx.drawImage(ovc, d.x, d.y, d.w, d.h, d.x, d.y, d.w, d.h);
      }
    }

    // Ink that did not quite take: pale flecks over the printed areas only.
    ctx.globalCompositeOperation = "screen";
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = grain;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
  };

  stage.onFrame((dt) => {
    let active = dirty;
    dirty = false;
    if (stillT == null) {
      for (const s of slugs) {
        const nudge = s === held ? s.nudge : 0;
        // Stiff and critically damped while held; a touch stiffer to seat.
        // Shoved sorts are stiffer than the hand, so they stay just ahead of
        // the sort pushing them instead of being passed through in transit.
        const K = s === held ? 900 : 1500;
        const C = 2 * Math.sqrt(K) * (s === held ? 0.82 : 1);
        s.units.forEach((u, j) => {
          if (u.settled && u.seat <= 0) return;
          active = true;
          // A queued sort holds its place until its turn in the sequence.
          if (u.wait > 0) {
            u.wait -= dt;
            if (u.wait <= 0) u.k = u.q;
          }
          const target = u.k + nudge;
          const sub = 3;
          const h = dt / sub;
          for (let i = 0; i < sub; i++) {
            u.v += (-K * (u.p - target) - C * u.v) * h;
            u.p += u.v * h;
          }
          u.seat = Math.max(0, u.seat - dt * 5);
          if (s !== held && !u.settled && u.wait <= 0 && Math.abs(u.p - target) < 0.01 && Math.abs(u.v) < 0.2) {
            const moved = u.p !== target;
            u.p = target;
            u.v = 0;
            u.settled = true;
            if (moved) {
              u.seat = 1;
              if (u.vis) knock(j);
            }
          }
        });
      }
    }
    // Nothing moving: leave the last frame on the canvas.
    if (active) draw();
  });

  return {
    destroy() {
      stage.destroy();
      try {
        ac?.close();
      } catch {
        /* closed */
      }
    },
  };
}
