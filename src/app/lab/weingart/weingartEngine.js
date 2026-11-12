// Weingart: a song credit set as a forme of metal type. Every line is a row
// of sorts, single pieces of lead, that move only in whole steps, straight
// down, so a word keeps its shape while its baseline breaks. A line's first
// sort is locked to its composed place on the chase's left margin, so the
// Swiss axis of the forme always holds: push a sort down and the line
// swings on that first sort like a lever, a step at a time, its far end
// first, so the line bends before it breaks into an uneven staircase
// hinged on the margin. Display type, brass and the credit lines all step
// by one unit, the brass rule's body, so every riser in the forme is a whole
// number of the same piece of brass. Only the brass's fine face prints. Sorts of the same ink are solid
// bodies: a line that comes down onto a neighbouring line shoves the sorts
// it lands on a step, the line bends to them from the margin, and past that
// knee it takes on the shoving line's own riser, sort for sort, and hands it
// on down the chain, so a full push nests the title lines as stairs. Lead
// stays in contact: no sort ever hangs more than its own body below the one
// before it. The brass rule is the bottom line's own foot: it is cut into
// one length per sort, each as wide as the sort above it, starting on the
// margin, and each length sits one body under its sort and drops with it,
// so the rule breaks at the line's joints and every letter stands on its
// own piece of lead. Only the run past the line's last sort steps on by
// itself, at the line's foot riser, to the figure. Its datum is the
// forme's foot: when the last sort's lead reaches it the run locks. The
// rule's last piece is cut to the
// red's measure: it is never set across the figure's face. It
// holds over the red's cap line as a head rule while the run behind it
// steps, and when the push brings it to its datum it seats in one knock
// across the feet of the red, so a full push ends with it overprinting the
// figure from the 3 to the 5. The writer's credit is set flush on the
// margin on the red's own baseline, so the foot of the forme is one line:
// credit at the left, figure at the right, and the brass seats on it. When a
// step would need the margin to give, the whole run locks. Only the red
// run, printed in a second pass, crosses the black, and where it does the
// two inks make a third. At rest the forme is strict: the title on the
// margin, the colophon flush on the red's edge, hung from the cap line of
// "Here". Every stair on the page is one a push made.
// ?t=0..1 holds a still of "Here" pushed down through the forme; t=1 is the
// last even stair before the run locks.
import { createStage, clamp } from "../_kit/stage";

// Design space the forme is composed in, fitted into the piece box.
const DW = 1000;
const DH = 600;
// One step. Small type, set in word slugs, steps by a third of its body.
// Type and rule drop straight down: sorts stay butted at their set widths,
// so a word keeps its shape and its word spaces and only the baseline
// breaks.
const STEP_BODY = 1 / 3;
// The forme's one riser: the brass rule's body, the lead it is cast on.
// Display type, brass and the credit lines all step by it, so every stair in
// the forme, type or rule, rises in whole multiples of the same piece of
// brass and they nest as one system instead of three pitches colliding.
const UNIT = 12;
// What prints of the brass: a fine face cast on that body, a third of it,
// high on the shoulder. The step is the body's, never the face's, so a
// lighter rule keeps the forme's rhythm.
const FACE = 4;
const FACE_AT = (UNIT - FACE) / 2;
// How far the face stands above the figure's baseline when the rule seats on
// it, design px. None: the face's foot is the figure's baseline, the credit's
// too, so the forme has one bottom line, and the face lies inside the feet of
// the figure, so the brass overprints the red instead of underlining it. The
// rule is placed so that this lands on a whole step.
const KISS = 0;
// The steepest a line can swing: drop from one sort to the next over the
// sort's average width. A line of small steps takes more of them to get there.
const STEEP = 0.8;
// How far a line can be dragged either way, in steps.
const D_MAX = 48;
// Below this size a line is set in word slugs, not single letters: a 13px
// letter stepped apart is no longer a word.
const LETTER_MIN = 40;
// Sidebearing trimmed off each side of a display letter's body, in em.
const SIDE = 0.06;
// Lead between two bodies that touch, design px; between two lines of the
// colophon, set solid on their own small leading, less.
const GAP = 8;
const GAP_SMALL = 2;
// Lead above and below a rule's body, so it never sits on a baseline as an underline.
const RULE_LEAD = 6;
// A display sort's body above the baseline, in em.
const CAP = 0.74;
// Seconds between neighbouring sorts seating, left to right; and between links of a chain.
const STAGGER = 0.034;
const STAGGER_HELD = 0.014;
const LINK = 0.06;

const PAPER = "#f7f6f2";
const BLACK = "#141414";
const RED = "#e3402a";
// Black printed over red: not flat multiply but a third, darker ink.
const OVER = "#7c1a10";

const law = (size) => -0.043 * (size - 12);

// The forme. x, y are the baseline-left (or rule top-left) of each line as composed.
const FORME = [
  { text: "The Beatles", size: 20, w: "strong", x: 4, y: 52 },
  { text: "3:05", size: 244, w: "semibold", ink: "red", x: 476, y: 592 },
  { text: "Here", size: 108, w: "semibold", x: 0, y: 168 },
  { text: "Comes", size: 108, w: "semibold", x: 0, y: 264 },
  { text: "the Sun", size: 108, w: "semibold", x: 0, y: 360 },
  // The rule is the foot of the bottom line, cut to it: under the line it is
  // one piece of brass per sort, each exactly as wide as the sort (or word
  // space) above it, the first starting on the title's margin (see cutRule).
  // Each piece is that sort's own lead: it sits a fixed three bodies below
  // the sort's baseline and drops when its sort drops, step for step, so the
  // brass breaks at the line's own joints and every letter stands on its own
  // piece. Past the last sort the run to the figure is case lengths that
  // keep their own steps at the line's foot riser, and the last piece is cut
  // to the measure of the figure, from the "3" to the right edge of the "5"
  // (see fitRule). At rest it is a full measure head rule over the red. The
  // last piece holds over the red's cap line until the run reaches its
  // datum, then seats there in one knock, its face on the red's baseline
  // across the feet of the figure.
  { rule: true, under: "the Sun", run: [56, 56, 156], body: UNIT, x: 0, y: 368, fit: "red" },
  // The writer's credit, plain small type in full ink, set flush on the
  // title's margin (its first ink on the stem of the "H") and on the red's
  // own baseline (see foot), so the bottom of the forme is one line: credit
  // at the left, figure at the right, and the rule's last piece seating
  // across the feet of the red on its final knock.
  { text: "Written by George Harrison", size: 13, scale: "ui", w: "small", foot: "red" },
  // The colophon is set flush left on the red's axis, the left edge of the
  // "3", where the rule's last piece starts, and hangs from the cap line of
  // "Here": its first line's caps stand on that line (see hang). Below it the
  // lines are set on whole-pixel leading of the 4px grid (lead, baseline to
  // baseline). At rest it is a plain flush-left block, so the page has two
  // verticals, the title margin and the figure edge; it breaks only as any
  // other line does, locked at its first sort to that axis, one riser at a time.
  { text: "Abbey Road", size: 20, w: "strong", hang: "red" },
  { text: "Side two, track one", size: 13, w: "body", hang: "red", lead: 24 },
  { text: "Apple Records", size: 13, w: "body", hang: "red", lead: 20 },
  { text: "London, 26 September 1969", size: 13, w: "body", hang: "red", lead: 20 },
];
// The line the colophon hangs from: the cap line of this one.
const HANG_FROM = "Here";

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
    // Small text on the ladder's 450 rung, which the scale has no name for:
    // the piece's own token (weingart.css).
    small: getComputedStyle(host).getPropertyValue("--font-weight-small").trim() || "450",
  };
  // A line set to a step of the type scale takes its size from the token.
  const sized = (d) => (d.scale ? { ...d, size: parseFloat(cs.getPropertyValue(`--text-${d.scale}`)) || d.size } : d);
  try {
    await Promise.all(Object.values(weight).map((w) => document.fonts.load(`${w} 40px ${sans}`)));
  } catch {
    /* draw with whatever is loaded */
  }

  let held = null;

  // A line's own step, to the half pixel, and its reach: the most whole
  // steps one sort can sit below (or above) its left neighbour. That is its
  // own body height, so a sort never loses contact with the one before it:
  // lead stays in contact, it does not float. A rule's pieces are separate
  // brass, so a rule can drop three bodies at a joint.
  const stepOf = (d) => {
    const step = d.rule || d.hang || d.foot || d.size >= LETTER_MIN ? UNIT : d.size * STEP_BODY;
    const sy = Math.round(step * 2) / 2;
    const body = d.rule ? d.body + RULE_LEAD * 2 : d.size * CAP;
    return { sy, reach: d.rule ? 3 : Math.max(1, Math.floor(body / sy + 1e-6)) };
  };

  const slugs = FORME.map(sized).map((d, i) => ({
    ...d,
    id: i,
    vec: null,
    nudge: 0,
    layer: d.ink === "red" ? "red" : "black",
    font: d.rule ? null : `${weight[d.w]} ${d.size}px ${sans}`,
    kind: d.rule ? "rule" : d.size >= LETTER_MIN ? "letter" : "word",
    ...stepOf(d),
    cx: null,
    units: [],
  }));

  // Cut each line into its sorts. Prefix advances keep the font's own
  // kerning; the law's tracking is added once per letter and never changes.
  const sort = (x, w, extra) => ({ x, w, p: 0, v: 0, k: 0, q: 0, wait: 0, seat: 0, settled: true, vis: true, ...extra });
  // A rule fitted to a figure is locked up to its measured ink: the joint
  // before its last piece is cut to the figure's left edge, and the last
  // piece runs to the figure's right edge. Its datum is the figure's feet:
  // that many bodies below the rule, the brass's face crosses the figure just
  // above the line it stands on and goes no deeper, so a full push ends with
  // the last tread overprinting the figure.
  // A glyph measured as large as it can be without leaving the size the
  // browser draws it at (its ink bounds come back in whole pixels, and change
  // outline past about 256px), so an edge is placed to a fraction of a pixel.
  const measure = (s, ch) => {
    const k = Math.max(1, Math.floor(240 / s.size));
    ctx.font = `${weight[s.w]} ${s.size * k}px ${sans}`;
    const m = ctx.measureText(ch);
    return { left: m.actualBoundingBoxLeft / k, cap: m.actualBoundingBoxAscent / k };
  };
  const bearing = (s, ch) => measure(s, ch).left;
  // A figure's measured ink, left and right, in design space.
  const inkSpan = (layer) => {
    const red = slugs.find((o) => o.layer === layer);
    const n = red.text.length;
    ctx.font = red.font;
    const r = red.x + red.cx[n - 1] + ctx.measureText(red.text[n - 1]).actualBoundingBoxRight;
    return {
      red,
      l: red.x + red.cx[0] - bearing(red, red.text[0]),
      r,
    };
  };
  const fitRule = (s) => {
    const span = inkSpan(s.fit);
    const red = span.red;
    const l = span.l - s.x;
    const r = span.r - s.x;
    const us = s.units;
    const lead = us[us.length - 1].x;
    // The last piece of case length before the figure is trimmed or packed to
    // meet it. The joint sits half a body out, so when the rule steps there
    // the piece before stands clear of the figure's left edge: no brass prints
    // over the figure except its own rule.
    const at = l - s.body / 2;
    us[us.length - 2].w += at - lead;
    us[us.length - 1].x = at;
    us[us.length - 1].w = r - at;
    // The deepest whole step at which the face still stands KISS above the
    // baseline, so the rule seats across the feet of the figure. The rule's
    // pieces under the line never go past it either: it is the forme's foot.
    s.datum = Math.floor((red.y - KISS - FACE - FACE_AT - s.y) / s.sy);
  };
  // The last piece of a fitted rule is the figure's own rule, so it is
  // never set across the figure's face: it holds where it was composed, a
  // head rule over the cap line, while the run behind it steps, and only
  // when the push brings it to the datum does it go, in one knock, across
  // the feet. Its place in the line's state is still counted as the lever
  // and the chain move it; this is where it is printed.
  const shownAt = (s, v, j) => {
    if (!s.fit || j !== s.units.length - 1) return v[j];
    return v[j] >= s.datum ? s.datum : 0;
  };
  // Lines set on a figure's axis: each line's first ink flush on the
  // figure's left ink edge, the first line's caps on the cap line of
  // HANG_FROM, the rest a whole lead below the line before. Placed once, with
  // the forme; the lever and the chain work on them from there.
  const capOf = (s) => measure(s, "H").cap;
  const hang = () => {
    const from = slugs.find((o) => o.text === HANG_FROM);
    // A line set on a figure's foot: its first ink flush on the title's
    // margin, the left ink of HANG_FROM's first sort, and its baseline the
    // figure's own, so the two stand on one line across the forme.
    for (const s of slugs) {
      if (!s.foot) continue;
      const fig = slugs.find((o) => o.layer === s.foot);
      s.x = from.x + from.cx[0] - bearing(from, from.text[0]) + bearing(s, s.text[0]);
      s.y = fig.y;
    }
    let y = null;
    for (const s of slugs) {
      if (!s.hang) continue;
      const { l } = inkSpan(s.hang);
      s.x = l + bearing(s, s.text[0]);
      y = y == null ? Math.round(from.y - capOf(from) + capOf(s)) : y + s.lead;
      s.y = y;
    }
  };
  // A rule set under a line is cut to it: one piece per sort, as wide as the
  // sort, the first from the title's margin, so each sort of the line stands
  // on its own length of brass. Past the line's last sort, the run to the
  // figure is case lengths.
  const cutRule = (s) => {
    const m = slugs.find((o) => o.text === s.under);
    const margin = m.x + m.cx[0] - bearing(m, m.text[0]) - s.x;
    const n = m.units.length;
    s.master = m;
    s.bound = n;
    s.units = m.units.map((u, i) => {
      const x0 = i === 0 ? margin : m.x + u.x - s.x;
      return sort(x0, m.x + u.x + u.w - s.x - x0);
    });
    let at = s.units[n - 1].x + s.units[n - 1].w;
    for (const w of s.run) s.units.push(sort((at += w) - w, w));
  };
  const cut = () => {
    for (const s of slugs) {
      if (s.rule) continue;
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
          s.units.push(sort(s.cx[i0], s.cx[i1] - s.cx[i0], { i0, i1, desc: /[gjpqy,]/.test(m[0]) }));
        }
      }
      // Each sort's printed ink, from its own origin, for telling when two
      // sorts of one line would print over each other.
      for (const u of s.units) {
        const m = ctx.measureText(s.text.slice(u.i0, u.i1));
        u.ink = { x0: -m.actualBoundingBoxLeft, x1: m.actualBoundingBoxRight, y0: -m.actualBoundingBoxAscent, y1: m.actualBoundingBoxDescent };
      }
      s.units[0].first = true;
      s.units[s.units.length - 1].last = true;
    }
    for (const s of slugs) if (s.rule) cutRule(s);
    for (const s of slugs) if (s.fit) fitRule(s);
    hang();
    for (const s of slugs) {
      s.vec = s.units.map(() => 0);
      s.pitch = (s.units[s.units.length - 1].x + s.units[s.units.length - 1].w) / s.units.length;
      // Each sort's place on the lever, counted in printing sorts from the
      // margin: a word space is lead that prints nothing, so it rides on the
      // tread of the sort before it and never spends a step of its own.
      let n = -1;
      s.ord = s.units.map((u) => (u.vis ? ++n : Math.max(n, 0)));
    }
  };
  cut();

  // A line's state is one whole step per sort, counted from where it was
  // composed. The first sort never moves: it is locked on the margin, and
  // the line is a lever hinged on it. Push sort j one step (dir) and the
  // line swings until j sits that step further on. The drop is shared out
  // over the printing sorts between the margin and j in whole steps, the
  // far ones first: 0, 0, 0, 1, then 0, 0, 1, 2, then 0, 1, 2, 3, then
  // 0, 1, 2, 4. So a line bends a step at a time: one step on "Here" drops
  // only its last letter, the next tips the middle too, and only a long
  // pull breaks it into a full staircase. Flat treads are allowed: a word
  // stays a word until it is pushed far enough to come apart. Sorts past j
  // run on a step each. No line swings steeper than STEEP: past that it is
  // locked.
  const lever = (s, D, J) => {
    const a = Math.abs(D);
    const q = Math.floor(a / J);
    const r = a - q * J;
    return s.ord.map((n) => Math.sign(D) * (n <= J ? n * q + Math.max(0, n - (J - r)) : a + n - J));
  };
  // A sort's ink at offset o steps, with a hair of clearance.
  const inkRect = (s, u, o) => ({
    x: s.x + u.x + u.ink.x0 - 1,
    y: s.y + o * s.sy + u.ink.y0 - 1,
    w: u.ink.x1 - u.ink.x0 + 2,
    h: u.ink.y1 - u.ink.y0 + 2,
  });
  // Lead cannot pass through lead: a sort stepped up runs back left, so it
  // can only rise until it meets the shoulder of the sort before it. (A rule
  // is one body, joined by its risers.)
  const clash = (s, w) => {
    if (s.rule) return false;
    let p = -1;
    for (let i = 0; i < w.length; i++) {
      if (!s.units[i].vis) continue;
      if (p >= 0 && w[i] < w[p]) {
        const a = inkRect(s, s.units[p], w[p]);
        const b = inkRect(s, s.units[i], w[i]);
        if (b.x < a.x + a.w && b.y < a.y + a.h && a.y < b.y + b.h) return true;
      }
      p = i;
    }
    return false;
  };

  // A line with a datum seats on it: sorts ahead of the one pushed come to
  // rest there and run on along it, and the pushed sort itself cannot pass
  // it, so the run locks. False when the push would drive j through it.
  const seat = (s, w, j) => {
    if (s.datum == null) return true;
    for (let i = 1; i < w.length; i++) {
      if (w[i] <= s.datum) continue;
      if (i <= j) return false;
      w[i] = s.datum;
    }
    for (let i = 1; i < w.length; i++) if (Math.abs(w[i] - w[i - 1]) > s.reach) return false;
    return true;
  };

  // No sort may sit more than its reach from its left neighbour either: the
  // run stays in contact the way real lead does, and past that it locks.
  // Returns false if the push cannot be made.
  const shove = (s, v, j, dir) => {
    const J = s.ord[j];
    if (j <= 0 || J <= 0) return false;
    const D = v[j] + dir;
    if ((Math.abs(D) / J) * s.sy > STEEP * s.pitch) return false;
    const to = lever(s, D, J);
    const w = v.slice();
    let p = 0;
    for (let i = 1; i < w.length; i++) {
      w[i] = dir > 0 ? Math.max(w[i], to[i]) : Math.min(w[i], to[i]);
      if (!s.units[i].vis) w[i] = w[p];
      else p = i;
      if (Math.abs(w[i] - w[i - 1]) > s.reach) return false;
    }
    if (!seat(s, w, j) || clash(s, w)) return false;
    for (let i = 1; i < w.length; i++) v[i] = w[i];
    return true;
  };
  // A line that is shoved is not swung by a hand: the sort it is hit on goes
  // a step on (dir), and only as much else as it needs. Behind it, the sorts
  // back to the margin bend down to it along the lever, never further than
  // their reach from the next; ahead of it, the run steps on by the riser it was handed (rise, design px) for every sort,
  // unless it already sits deeper. So a shoved line bends where it was hit
  // and runs on parallel to the line that hit it: one pitch down the forme.
  // Hit on its first sort, the margin holds and the run locks. Returns
  // false then.
  const carry = (s, v, j, dir, rise = 0) => {
    const J = s.ord[j];
    if (j <= 0 || J <= 0) return false;
    // Worked in the direction the line is broken: sd turns it the right way up.
    const sd = v[j] * dir >= 0 ? dir : -dir;
    const u = v.map((x) => x * sd);
    const deeper = dir * sd > 0;
    if (!deeper && u[j] < 1) return false;
    u[j] += deeper ? 1 : -1;
    const to = lever(s, u[j], J);
    // Past the knee the run takes on the shoving line's riser, sort for
    // sort, so the two lines nest as parallel stairs.
    const R = Math.min(s.reach, Math.max(0, Math.round(rise / s.sy)));
    let p = j;
    for (let i = j + 1; i < u.length; i++) {
      if (!s.units[i].vis) continue;
      if (deeper) u[i] = Math.max(u[i], u[p] + R * (s.ord[i] - s.ord[p]));
      p = i;
    }
    let nx = j;
    for (let i = j - 1; i > 0; i--) {
      if (!s.units[i].vis) continue;
      u[i] = deeper ? Math.min(Math.max(u[i], to[i], u[nx] - s.reach), u[nx]) : Math.min(u[i], u[nx]);
      nx = i;
    }
    // A word space rides on the tread of the sort before it.
    for (let i = 1; i < u.length; i++) if (!s.units[i].vis) u[i] = u[i - 1];
    for (let i = 1; i < u.length; i++) if (Math.abs(u[i] - u[i - 1]) > s.reach) return false;
    const w = u.map((x) => x * sd);
    if (!seat(s, w, j) || clash(s, w)) return false;
    for (let i = 1; i < w.length; i++) v[i] = w[i];
    return true;
  };
  // A line's pitch: its steepest riser between printing sorts, in design px.
  // A line it shoves takes this on past its knee, and hands it on down the
  // chain, so the whole forme stairs to the riser of the line in the hand.
  const riseOf = (s, v) => {
    let r = 0;
    let p = 0;
    for (let i = 1; i < v.length; i++) {
      if (!s.units[i].vis) continue;
      r = Math.max(r, Math.abs(v[i] - v[p]));
      p = i;
    }
    return r * s.sy;
  };
  // A rule under a line is that line's lead: each piece under a sort sits at
  // the sort's own depth, so the brass stair and the type stair share one
  // pitch and one set of joints. The run past the line's last sort keeps
  // stepping on at the line's foot riser, never past the datum. Null where a
  // piece would have to go below the forme's foot: the run locks.
  const follow = (r, mv) => {
    const m = r.master;
    const v = r.units.map((u, i) => (i < r.bound ? mv[i] : 0));
    let last = 0;
    let prev = 0;
    for (let i = 1; i < r.bound; i++) {
      if (!m.units[i].vis) continue;
      prev = last;
      last = i;
    }
    if (v.some((x, i) => i < r.bound && x > r.datum)) return null;
    const R = mv[last] - mv[prev];
    for (let i = r.bound; i < v.length; i++) v[i] = Math.min(r.datum, v[i - 1] + R);
    return v;
  };
  // A line dragged d steps from base by its sort j, or null where it locks.
  const dragged = (s, base, j, d) => {
    const v = base.slice();
    for (let i = 0; i < Math.abs(d); i++) if (!shove(s, v, j, Math.sign(d))) return null;
    return v;
  };

  // One sort's body in design space at offset o steps.
  const unitRect = (s, u, o) => {
    const x = s.x + u.x;
    const y = s.y + o * s.sy;
    if (s.rule) return { x, y: y - RULE_LEAD, w: u.w, h: s.body + RULE_LEAD * 2 };
    const desc = u.desc ? s.size * 0.2 : 0;
    // A letter's shoulder is trimmed to its sidebearings, so a sort can step
    // down past the edge of one in the line below instead of catching on air.
    const w = Math.max(u.w, s.size * 0.3);
    const side = s.kind === "letter" ? s.size * SIDE : 0;
    return { x: x + side, y: y - s.size * CAP, w: w - side * 2, h: s.size * CAP + desc };
  };
  // One sort's solid body: a rule's body without its lead.
  const faceRect = (s, u, o) => {
    const r = unitRect(s, u, o);
    return s.rule ? { x: r.x, y: r.y + RULE_LEAD, w: r.w, h: s.body } : r;
  };
  // A rule's bodies, so where it steps, the joint is filled by a riser from
  // the end of one piece to the start of the next, spanning both: the lead
  // under a broken rule stays solid. off(u, j) is each sort's offset in
  // steps; face=false gives the bodies, lead and all.
  const ground = (s, off, face = true) => {
    const out = [];
    let prev = null;
    const last = s.units.length - 1;
    s.units.forEach((u, j) => {
      const r = { ...faceRect(s, u, off(u, j)), j };
      // A fitted rule's last piece held above the run behind it stands
      // alone, its own piece of brass: no riser climbs back up to it.
      const alone = prev && s.fit && j === last && r.y < prev.y;
      if (prev && !alone) {
        const a = prev.x + prev.w;
        // A brass rule drops straight down at its joints; the lead between
        // its pieces is as deep as its body, centred on the joint. It is
        // blind: it holds the run in contact but never prints.
        const half = s.rule && prev.y !== r.y ? s.body / 2 : 0;
        const x0 = Math.min(a, r.x) - half;
        const x1 = Math.max(a, r.x) + half;
        const y0 = Math.min(prev.y, r.y);
        const y1 = Math.max(prev.y + prev.h, r.y + r.h);
        if (x1 - x0 > 1e-3 || prev.y !== r.y) out.push({ x: x0, y: y0, w: Math.max(x1 - x0, 1e-3), h: y1 - y0, j, riser: true });
      }
      out.push(r);
      prev = r;
    });
    if (face) return out;
    return out.map((r) => ({ ...r, y: r.y - RULE_LEAD, h: r.h + RULE_LEAD * 2 }));
  };
  const rectsFor = (s, off) => {
    if (s.rule) return ground(s, off, false);
    const out = [];
    s.units.forEach((u, j) => u.vis && out.push({ ...unitRect(s, u, off(u, j)), j }));
    return out;
  };
  const rectsAt = (s, v) => rectsFor(s, (u, j) => shownAt(s, v, j));
  const rectsNow = (s) => rectsFor(s, (u) => u.p);
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

  // Bodies side by side in neighbouring lines pass; lead is only above and below.
  const touches = (a, b, g = GAP) =>
    a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h + g && b.y < a.y + a.h + g;
  const gapOf = (a, b) => (a.hang && b.hang ? GAP_SMALL : GAP);
  // Two lines touch if any sort of one touches any sort of the other.
  const touchesAny = (A, B, g = GAP) => {
    if (!touches(union(A), union(B), g)) return false;
    for (const a of A) for (const b of B) if (touches(a, b, g)) return true;
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
    const next = new Map([[s, { v: vec, depth: 0, rise: riseOf(s, vec) }]]);
    const queue = [{ a: s, depth: 0 }];
    const stateOf = (o) => (next.has(o) ? next.get(o).v : o.vec);
    let guard = 0;
    while (queue.length) {
      if (++guard > 600) return null;
      const { a, depth } = queue.shift();
      if (!fits(a, stateOf(a))) return null;
      const ra = rectsAt(a, stateOf(a));
      const ua = union(ra);
      const rise = next.get(a).rise;
      for (const o of slugs) {
        // A rule under a line is not shoved: it follows its line (below).
        if (o === a || o.layer !== a.layer || o.master) continue;
        const v0 = stateOf(o);
        const g = gapOf(a, o);
        if (!touchesAny(ra, rectsAt(o, v0), g)) continue;
        // A body behind the push can never be cleared by shoving it on.
        if (o === s) return null;
        const vo = v0.slice();
        // One sort at a time, the one furthest along the line first, so a
        // shoved line moves no more than it has to.
        for (let n = 0; ; n++) {
          let j = -1;
          for (const r of rectsAt(o, vo)) {
            if (r.j > j && touches(ua, r, g) && ra.some((q) => touches(q, r, g))) j = r.j;
          }
          if (j < 0) break;
          // Landing on a line's first sort: the margin holds, the run locks.
          if (!carry(o, vo, j, dir, rise) || n > 200 || !fits(o, vo)) return null;
        }
        const was = next.get(o);
        next.set(o, { v: vo, depth: Math.max(was?.depth ?? 0, depth + 1), rise: Math.max(was?.rise ?? 0, rise) });
        queue.push({ a: o, depth: depth + 1 });
      }
    }
    // The lead under a line that moved comes with it, a beat behind.
    for (const r of slugs) {
      const m = r.master && next.get(r.master);
      if (!m) continue;
      const v = follow(r, m.v);
      if (!v || !fits(r, v)) return null;
      next.set(r, { v, depth: m.depth + 1, rise: 0 });
    }
    // Whatever moved must end clear of every other body of its ink; a line
    // and its own lead are one.
    for (const [m, { v }] of next) {
      const rm = rectsAt(m, v);
      for (const o of slugs) {
        if (o === m || o.layer !== m.layer || o.master === m || m.master === o) continue;
        if (touchesAny(rm, rectsAt(o, stateOf(o)), gapOf(m, o))) return null;
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
      const to = shownAt(s, vec, j);
      if (!animate) {
        u.p = u.k = u.q = to;
        u.v = 0;
        u.wait = 0;
        u.settled = true;
        return;
      }
      if (to === u.q) return;
      u.q = to;
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
      const v = dragged(s, base, j, at + dir);
      const pl = v && plan(s, v, dir);
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
  // Sheets: each ink is printed on its own (red, black), and the third ink
  // is worked out where the two sheets cross.
  const sheet = () => {
    const c = document.createElement("canvas");
    return [c, c.getContext("2d")];
  };
  const [ovc, ov] = sheet();
  const [redc, rctx] = sheet();
  const [blkc, bctx] = sheet();
  let dirty = true;

  const limits = () => {
    const m = 12 / scale;
    chase = { lo: -ox / scale + m, hi: (W - ox) / scale - m, top: -oy / scale + m, bot: (H - oy) / scale - m };
  };

  // Still: from the composed forme, push "Here" down the chase by its last
  // sort and let it shove everything below it. t is the fraction of the way
  // to where the whole run locks against the chase; t=1 is the last even
  // stair short of that lock.
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
    // A full push holds the last even stair before the lock: "Here" one
    // riser per sort, so the lines it shoves take that riser on.
    const J = here.ord[tail];
    const at = Math.round(stillT * all);
    drag(here, here.vec, tail, 0, stillT === 1 ? at - (at % J) : at, false);
  };

  stage.onResize((w, h, d) => {
    W = w;
    H = h;
    dpr = d;
    for (const c of [ovc, redc, blkc]) {
      c.width = canvas.width;
      c.height = canvas.height;
    }
    const pad = Math.max(16, Math.min(w, h) * 0.08);
    scale = Math.min((w - pad * 2) / DW, (h - pad * 2) / DH, 1.25);
    // Sit a little left of centre and a little high: an asymmetric forme.
    ox = (w - DW * scale) * 0.44;
    oy = (h - DH * scale) * 0.46;
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
        if (dx >= r.x - pad && dx <= r.x + r.w + pad && dy >= r.y - py && dy <= r.y + r.h + py) {
          // Lead under a line is worked through its sort: a hand on a piece
          // pushes the sort standing on it, on the run the line's last sort.
          if (s.master) return { s: s.master, j: Math.min(r.j, s.bound - 1) };
          return { s, j: r.j };
        }
      }
    }
    return null;
  };

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
    // is behind it trails into a staircase. The first sort is locked, so a
    // hand on it works the sort beside it.
    grab = { x: p.x, y: p.y, base: s.vec.slice(), j: Math.max(1, h.j), d: 0 };
    s.lockedAt = false;
    canvas.style.cursor = "grabbing";
  });

  stage.on("move", (p) => {
    if (!held) {
      canvas.style.cursor = hit(p.x, p.y) ? "grab" : "";
      return;
    }
    // Lead only drops straight down: the pull is read along the drop.
    const r = (p.y - grab.y) / scale / held.sy;
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
  // Brass prints only its face. Each piece is its own length of brass, so
  // where the rule breaks the pieces just sit at their own depths, end butted
  // to end: no riser is printed, the body's riser is lead and stays blind.
  // A piece seats with the same small knock as a sort.
  const fillBrass = (g, s) => {
    g.beginPath();
    for (const u of s.units) g.rect(s.x + u.x, s.y + u.p * s.sy + u.seat * u.seat * 0.8 + FACE_AT, u.w, FACE);
    g.fill();
  };

  // The knock: a sort just seated sits a hair deep for a moment.
  const sortAt = (s, u) => [s.x, s.y + u.p * s.sy + u.seat * u.seat * 0.8];
  const glyphs = (g, s, u, x, y) => {
    for (let i = u.i0; i < u.i1; i++) {
      const ch = s.text[i];
      if (ch !== " ") g.fillText(ch, x + s.cx[i], y);
    }
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
  // One type sort printed onto an ink sheet where it sits, in flat, solid ink.
  const printSort = (g, s, u, ink) => {
    const [x, y] = sortAt(s, u);
    toForme(g);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.fillStyle = ink;
    g.font = s.font;
    g.textBaseline = "alphabetic";
    glyphs(g, s, u, x, y);
  };

  const printLayer = (g, layer) => {
    const ink = layer === "red" ? RED : BLACK;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.globalAlpha = 1;
    g.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of slugs) {
      if (s.layer !== layer) continue;
      if (s.rule) {
        // The brass faces, butted end to end where the run is level.
        toForme(g);
        g.fillStyle = ink;
        fillBrass(g, s);
        continue;
      }
      for (const u of s.units) if (u.vis) printSort(g, s, u, ink);
    }
  };

  const draw = () => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Red run first, then black over it; inks multiply into the paper.
    printLayer(rctx, "red");
    printLayer(bctx, "black");
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(redc, 0, 0);
    ctx.drawImage(blkc, 0, 0);
    ctx.globalCompositeOperation = "source-over";

    // Where black lands on red the two inks make a third: inside each red
    // slug's box, the black sheet kept only where the red sheet printed, in
    // the dark ink.
    for (const red of slugs) {
      if (red.layer !== "red") continue;
      const d = devRect(union(rectsNow(red)), red.size ? red.size * 0.12 : 4);
      if (!d.w || !d.h) continue;
      ov.setTransform(1, 0, 0, 1, 0, 0);
      ov.globalAlpha = 1;
      ov.globalCompositeOperation = "source-over";
      ov.clearRect(d.x, d.y, d.w, d.h);
      ov.drawImage(blkc, d.x, d.y, d.w, d.h, d.x, d.y, d.w, d.h);
      ov.globalCompositeOperation = "destination-in";
      ov.drawImage(redc, d.x, d.y, d.w, d.h, d.x, d.y, d.w, d.h);
      ov.globalCompositeOperation = "source-in";
      ov.fillStyle = OVER;
      ov.fillRect(d.x, d.y, d.w, d.h);
      ov.globalCompositeOperation = "source-over";
      ctx.drawImage(ovc, d.x, d.y, d.w, d.h, d.x, d.y, d.w, d.h);
    }
  };

  stage.onFrame((dt) => {
    let active = dirty;
    dirty = false;
    if (stillT == null) {
      for (const s of slugs) {
        // The pull shows along the lever: nothing at the hinge, most at the far end.
        const pull = s === held ? s.nudge / grab.j : 0;
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
          const target = u.k + pull * j;
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
