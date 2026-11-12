// Weingart: a song credit set as a forme of metal type. Every line is a row
// of sorts, single pieces of lead, that move only in whole steps, straight
// down, so a word keeps its shape while its baseline breaks. A line's first
// sort is locked to the chase's left margin, so the Swiss axis of the forme
// always holds. The display lines break only at a few joins, a word space or
// one break inside a long word (He|re, Co|mes, the |Sun); between joins the
// sorts are locked up as one piece on one shared baseline, and each join
// drops a whole tread, the title's x-height on the brass's own pitch. So a
// broken line is flat treads and hard risers, never a slope. Push a line
// down and it breaks at its join; push harder and the push passes into the
// stack under it: the line below breaks at its join, then the next, one
// tread at a time, until the title is three stairs stacked to the foot of
// the forme. A line that is shoved by the one above goes down whole, a tread
// at a time, still on the margin, so lines never run into each other. Small
// type steps by the brass body and bends in word slugs, hinged on its first
// word. The brass rule is one length, never cut, from the margin to the
// right edge of the figure, set at rest as the foot of the title. It is
// solid and only ever moves whole: the moment a sort comes down into its
// lead it drops in one knock to the forme's foot, its heavy face across the
// bottom strokes of the red, just over the writer's credit, and there the
// black overprints the red and the two inks make a third. Type that comes
// down onto it there locks the run; when its composed place is clear again
// it goes back. The writer's credit is set flush on the margin on the red's
// own baseline. At rest the forme is strict: the title on the margin, the
// colophon flush on the red's edge, hung from the cap line of "Here". Every
// stair on the page is one a push made.
// ?t=0..1 holds a still of "Here" pushed down through the forme, one tread
// per push; t=1 is the last tread before the run locks.
import { createStage, clamp } from "../_kit/stage";

// Design space the forme is composed in, fitted into the piece box.
const DW = 1000;
const DH = 600;
// One step. Small type, set in word slugs, steps by a third of its body.
// Type drops straight down: sorts stay butted at their set widths,
// so a word keeps its shape and its word spaces and only the baseline
// breaks.
const STEP_BODY = 1 / 3;
// The forme's one riser: the brass rule's body, the lead it is cast on.
// Brass and the credit lines step by it, and display type by a tread of a
// whole number of it (TREAD, below), so every stair in the forme, type or
// rule, rises in whole multiples of the same piece of brass.
const UNIT = 12;
// What prints of the brass: a heavy face, nearly the whole body, so where
// it crosses the red the overprint is a band of the third ink, not a
// hairline. The step is the body's, never the face's.
const FACE = 10;
const FACE_AT = (UNIT - FACE) / 2;
// Lead between the seated rule's face and the caps of the credit set under
// it on the forme's foot, design px. The rule is composed so that, a whole
// number of steps down, this lands its face in the solid of the figure's
// feet, under the counters.
const KISS = 6;
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
  // Display lines break only at their joins, marked "|", in the order a
  // push opens them: a word space, or one break inside a long word. Between
  // joins the sorts are locked up as one piece on one baseline, so a broken
  // line is flat treads with hard risers, never a slope.
  { text: "3:05", size: 244, w: "semibold", ink: "red", x: 476, y: 592, joins: ["3:|05"] },
  { text: "Here", size: 108, w: "semibold", x: 0, y: 168, joins: ["He|re"] },
  { text: "Comes", size: 108, w: "semibold", x: 0, y: 264, joins: ["Co|mes"] },
  { text: "the Sun", size: 108, w: "semibold", x: 0, y: 360, joins: ["the |Sun"] },
  // The rule: one length of brass, never cut, from the title's margin to
  // the right edge of the "5" (see cutRule). At rest it is the foot of the
  // title, a full measure over the red. It is solid and only ever moves
  // whole: the moment a sort of the title comes down into its lead it drops,
  // in one knock, to the forme's foot, its face across the bottom of the
  // figure just over the credit's caps (see fitRule), and there the black
  // overprints the red. Type that comes down onto it there locks the run.
  // When its composed place is clear again it goes back.
  { rule: true, under: "the Sun", body: UNIT, x: 0, y: 372, fit: "red" },
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
  // lead stays in contact, it does not float. The rule is one piece and
  // has no joints, so its reach is never used.
  const stepOf = (d) => {
    const step = d.rule || d.hang || d.foot || d.size >= LETTER_MIN ? UNIT : d.size * STEP_BODY;
    const sy = Math.round(step * 2) / 2;
    return { sy, reach: d.rule ? 0 : Math.max(1, Math.floor((d.size * CAP) / sy + 1e-6)) };
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
  // The rule's seat: the deepest whole step at which its face still clears
  // the caps of the line set on the figure's foot by KISS. There the face
  // lies across the bottom strokes of the figure, inside its feet, so the
  // brass overprints the red instead of underlining it, and the credit sits
  // under it on the margin.
  const fitRule = (s) => {
    const foot = slugs.find((o) => o.foot === s.fit);
    const top = foot.y - measure(foot, foot.text).cap;
    s.datum = Math.floor((top - KISS - FACE - FACE_AT - s.y) / s.sy);
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
  // The rule is one length of brass, never cut: from the title's margin to
  // the right ink edge of the figure it is fitted to.
  const cutRule = (s) => {
    const m = slugs.find((o) => o.text === s.under);
    const margin = m.x + m.cx[0] - bearing(m, m.text[0]) - s.x;
    s.master = m;
    s.units = [sort(margin, inkSpan(s.fit).r - s.x - margin)];
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
    hang();
    for (const s of slugs) if (s.fit) fitRule(s);
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
  // The tread: display type drops by whole steps of the forme, the title's
  // x-height to the nearest brass body, so a broken word lands its foot a
  // full lowercase below the piece before it: a riser, not a slope. Each
  // join a push opens is one tread; a line hangs no more than one tread at
  // any join, so pushing harder opens the next join, it never steepens one.
  const title = slugs.find((o) => o.text === HANG_FROM);
  const TREAD = Math.max(UNIT, Math.round(measure(title, "x").cap / UNIT) * UNIT);
  for (const s of slugs) {
    if (!s.joins) continue;
    s.terrace = true;
    s.sy = TREAD;
    s.reach = 1;
    // Each join as the index of the sort that starts the piece after it.
    s.at = s.joins.map((j) => j.indexOf("|"));
    s.hinge = Math.min(...s.at);
  }

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
  // A display line breaks a tread at a time, and only at its joins: to take
  // sort j one tread further (dir), a join broken the other way is closed
  // first, the last one opened first; otherwise the next join at or before j
  // in the line's order opens, and every sort past it goes with it, locked
  // on one shared baseline. The line stays hinged on its first piece.
  // Returns false when there is no join left to open.
  const terrace = (s, v, j, dir) => {
    const riser = (k) => v[k] - v[k - 1];
    const open = (k) => {
      for (let i = k; i < v.length; i++) v[i] += dir;
      return true;
    };
    for (let n = s.at.length - 1; n >= 0; n--) if (s.at[n] <= j && riser(s.at[n]) * dir < 0) return open(s.at[n]);
    for (const k of s.at) if (k <= j && riser(k) === 0) return open(k);
    return false;
  };
  // One push on a display line in the hand. It breaks at its own next join;
  // once it has none left, a push down passes into the stack under it, and
  // the next display line below that can still break opens its join, top
  // to bottom. So pushing harder adds a tread to the forme, one at a time,
  // and never steepens one. Returns the line that breaks and its new state,
  // or null where the run is locked.
  const push = (s, j, dir) => {
    const v = s.vec.slice();
    if (terrace(s, v, j, dir) && !clash(s, v)) return [s, v];
    if (dir < 0) return null;
    const below = slugs.filter((o) => o.terrace && o.layer === s.layer && o.y > s.y).sort((a, b) => a.y - b.y);
    for (const o of below) {
      const w = o.vec.slice();
      if (terrace(o, w, o.units.length - 1, dir)) return [o, w];
    }
    return null;
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
    if (clash(s, w)) return false;
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
    // A display line that is shoved does not break: it goes on whole, a
    // tread at a time, its first sort still on the margin.
    if (s.terrace) {
      for (let i = 0; i < v.length; i++) v[i] += dir;
      return true;
    }
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
    if (clash(s, w)) return false;
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
  const rectsFor = (s, off) => {
    const out = [];
    s.units.forEach((u, j) => u.vis && out.push({ ...unitRect(s, u, off(u, j)), j }));
    return out;
  };
  const rectsAt = (s, v) => rectsFor(s, (u, j) => v[j]);
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
        // The rule is not shoved a step at a time: it goes whole (below).
        if (o === a || o.layer !== a.layer || o.rule) continue;
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
    // Whatever moved must end clear of every other body of its ink.
    for (const [m, { v }] of next) {
      const rm = rectsAt(m, v);
      for (const o of slugs) {
        if (o === m || o.layer !== m.layer || o.rule) continue;
        if (touchesAny(rm, rectsAt(o, stateOf(o)), gapOf(m, o))) return null;
      }
    }
    // The rule is one piece of brass and only ever moves whole. Type that
    // comes down into its lead knocks it, in one go, from its composed place
    // to its seat on the forme's foot; type that comes down onto it there
    // locks the run. Once its composed place is clear again it goes back.
    let deepest = 0;
    for (const { depth } of next.values()) deepest = Math.max(deepest, depth);
    for (const r of slugs) {
      if (!r.rule) continue;
      const hitAt = (k) => {
        const rr = rectsAt(r, r.units.map(() => k));
        return slugs.some((o) => o !== r && o.layer === r.layer && touchesAny(rr, rectsAt(o, stateOf(o)), 0));
      };
      const was = r.vec[0];
      const k = hitAt(0) ? r.datum : 0;
      if (k && hitAt(k)) return null;
      if (k !== was) next.set(r, { v: r.units.map(() => k), depth: deepest + 1, rise: 0 });
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
    // A display line moves as locked-up pieces: everything a step moves goes
    // on one beat, the beat of its first sort, and only that sort knocks.
    const first = s.terrace ? s.units.findIndex((u, j) => vec[j] !== u.q) : -1;
    s.units.forEach((u, j) => {
      const to = vec[j];
      const beat = s.terrace ? first : j;
      u.head = !s.terrace || j === first;
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
      if (u.wait <= 0) u.wait = depth * LINK + beat * stagger + 1e-6;
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
      const step = s.terrace ? push(s, j, dir) : [s, dragged(s, base, j, at + dir)];
      const pl = step && step[1] && plan(step[0], step[1], dir);
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

  // Still: from the composed forme, push "Here" down by its last sort, one
  // tread a push, and let it break and shove everything below it. t is the
  // fraction of the pushes it takes to lock the run; t=1 is the last tread
  // before that lock.
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
          // The rule is worked through the line it is the foot of: a hand on
          // it pushes that line's far end.
          if (s.rule) return { s: s.master, j: s.master.units.length - 1 };
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
    // A display line held on its first piece, before any join, is worked by
    // its far end.
    const j = s.terrace && h.j < s.hinge ? s.units.length - 1 : Math.max(1, h.j);
    grab = { x: p.x, y: p.y, base: s.vec.slice(), j, d: 0 };
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
  // Brass prints only its face, and seats with the same small knock as a sort.
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
        // The pull shows along the lever: nothing at the hinge, most at the
        // far end. A display line shows it whole, past its first join.
        const pull = s !== held ? 0 : s.terrace ? s.nudge : s.nudge / grab.j;
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
          const target = u.k + (s.terrace ? (j >= s.hinge ? pull : 0) : pull * j);
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
              // Brass seating whole lands with one heavy knock.
              if (s.rule) click(520, 0.16, 1.1);
              else if (u.vis && u.head) knock(j);
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
