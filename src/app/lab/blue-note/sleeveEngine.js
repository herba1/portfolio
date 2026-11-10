import { createStage, clamp } from "../_kit/stage";
import { loadCover } from "../_kit/covers";

// A record sleeve set the way Reid Miles set Blue Note: two inks (black and
// one strong colour) printed on warm board, a photograph separated into
// those two plates, and the title set so big it runs off the square.
//
// Six finished layouts sit on a 3 x 2 torus. Dragging scrubs a playhead from
// one sleeve to the next, and nothing in between is ever a blend of two
// sleeves: the sleeve is re-set, the way a compositor slides type along a
// galley. The whole handoff is one push in the direction of the drag. The
// outgoing words are carried off the far edge in the order the push reaches
// them, front word first, and the incoming words are carried in from the
// near edge behind them, arriving while the last outgoing word is still on
// the square. Every word travels at the one speed along the one axis, and
// the timing is planned so that each frame still holds a whole word of the
// title and at most one word caught by an edge. The photograph's crop moves
// underneath, one pair of edges and then the other. Each ink is drawn on its
// own plate and overprinted (multiply), the black plate a hair out of
// register with the colour.

const GROUND = "#f2f0eb";
const BOARD = [247, 244, 237];
const COLOUR = [30, 82, 196]; // the one strong ink
const BLACK = [24, 23, 22];
const WEIGHT = 700; // display weight, the top of the ladder
const CREDIT_WEIGHT = 600; // the credit is a second tier, not display

// Let It Be's four portraits, in source pixels (480 square).
const PANELS = [
  [53, 52, 177, 177], // John at the microphone
  [246, 52, 177, 177], // Paul at the microphone
  [53, 244, 177, 177], // Ringo
  [246, 244, 177, 177], // George
];

const COLS = 3;
const ROWS = 2;
const STEP = 0.42; // sleeve widths of drag per layout

// The handoff, on a playhead u that runs 0 -> 1 from one sleeve to the next.
// At its own pace the playhead takes TOUR_S seconds per sleeve.
const TOUR_S = 1.1;
const PHOTO_END = 0.42; // the crop moves first: x edges, then y (or y, then x)
const PUSH = [0.02, 0.98]; // the span of u the push is spread over

const smoother = (u) => u * u * u * (u * (u * 6 - 15) + 10);
const span = (u, a, b) => clamp((u - a) / (b - a), 0, 1);
const lerp = (a, b, t) => a + (b - a) * t;
const tracking = (px) => -0.043 * (px - 12);

// ---------------------------------------------------------------- layouts
// All lengths are in sleeve widths. Words anchor at their baseline-left.
// k / c: whether the black / colour plate prints a word; a word neither
// plate prints is reversed out of whatever ink it sits on.
function layouts(adv) {
  const W = (x, y, s, o = {}) => ({ x, y, s, sx: 1, r: 0, k: 1, c: 0, ...o });
  const line = (x, y, s, o = {}, gap = 0.26) => {
    const a = W(x, y, s, o);
    const b = W(x + s * (adv.let + gap), y, s, o);
    const c = W(b.x + s * (adv.it + gap), y, s, o);
    return [a, b, c];
  };
  const photo = (x, y, w, h, p, fx = 0.5, fy = 0.5, z = 1) => ({ x, y, w, h, p, fx, fy, z });

  return [
    // 0. The plain one: picture on top, the title one line, cut by the edge.
    {
      photo: photo(0, 0, 1, 0.6, 0, 0.5, 0.42, 1.06),
      block: null,
      words: line(-0.012, 0.968, 0.38),
      credit: W(0.05, 0.672, 0.042, { k: 0, c: 1 }),
    },
    // 1. Unit Structures: the title stacked down the left, a tall portrait.
    {
      photo: photo(0.5, 0, 0.5, 1, 1, 0.47, 0.5, 1),
      block: null,
      words: [W(0.03, 0.43, 0.44), W(0.03, 0.75, 0.44, { k: 0, c: 1 }), W(0.03, 1.07, 0.44)],
      credit: W(0.04, 0.085, 0.042, { k: 0, c: 1 }),
    },
    // 2. Out to Lunch: one letter pair at the scale of the sleeve.
    {
      photo: photo(0.06, 0.06, 0.4, 0.4, 0, 0.4, 0.42, 1.55),
      block: null,
      words: [W(0.52, 0.205, 0.17), W(0.52 + 0.17 * (adv.let + 0.26), 0.205, 0.17), W(-0.1, 1.17, 1.22, { k: 0, c: 1 })],
      credit: W(0.522, 0.27, 0.042),
    },
    // 3. The title turned up the spine, the picture taking the rest.
    {
      photo: photo(0.33, 0, 0.67, 1, 3, 0.5, 0.5, 1),
      block: null,
      words: line(0.285, 0.985, 0.33, { r: -90, k: 0, c: 1 }).map((w) => ({ ...w, x: 0.285, y: 0.985 - (w.x - 0.285) })),
      credit: W(0.375, 0.955, 0.042, { k: 1, c: 0 }),
    },
    // 4. The Freedom Rider: a field of colour and the title on one baseline,
    // read left to right: "let", then "it" at the scale of the field and
    // reversed out of it, then "be". The small words overprint black.
    {
      photo: photo(0, 0.56, 1, 0.44, 2, 0.5, 0.36, 1.02),
      block: { x: 0, y: 0, w: 1, h: 0.56 },
      words: [
        W(0.05, 0.52, 0.15, { k: 1, c: 1 }),
        W(0.215, 0.52, 0.86, { k: 0, c: 0 }),
        W(0.215 + 0.86 * adv.it + 0.035, 0.52, 0.15, { k: 1, c: 1 }),
      ],
      credit: W(0.05, 0.075, 0.042, { k: 0, c: 0 }),
    },
    // 5. Hub-Tones: picture square in the corner, the title stretched wide
    // and the last word sitting on the bottom edge.
    {
      photo: photo(0.5, 0.04, 0.46, 0.46, 1, 0.55, 0.45, 1.25),
      block: null,
      words: [W(0.04, 0.705, 0.27, { sx: 1.3, k: 0, c: 1 }), W(0.04 + 0.27 * 1.3 * (adv.let + 0.22), 0.705, 0.27, { sx: 1.3, k: 0, c: 1 }), W(0.035, 1.0, 0.36, { sx: 1.3 })],
      credit: W(0.045, 0.1, 0.042),
    },
  ];
}

const TEXT = ["let", "it", "be", "the beatles"];
const weightOf = (i) => (i === 3 ? CREDIT_WEIGHT : WEIGHT);

// The box a word's ink covers, in sleeve units, from glyph metrics measured
// once at a reference size.
function wordBox(w, m) {
  const rad = (w.r * Math.PI) / 180;
  const cs = Math.cos(rad);
  const sn = Math.sin(rad);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const lx of [-m.l * w.sx * w.s, m.r * w.sx * w.s])
    for (const ly of [-m.a * w.s, m.d * w.s]) {
      const X = w.x + lx * cs - ly * sn;
      const Y = w.y + lx * sn + ly * cs;
      x0 = Math.min(x0, X);
      x1 = Math.max(x1, X);
      y0 = Math.min(y0, Y);
      y1 = Math.max(y1, Y);
    }
  return [x0, y0, x1, y1];
}

// ---------------------------------------------------------------- the push
// Lengths along the push are in sleeve widths; q runs 0 at the edge the new
// sleeve comes in from to 1 at the edge the old one leaves by. Plan time is
// in sleeve widths of travel, so every word moves at the one speed, and is
// scaled onto u afterwards.
const SOFT = 0.1; // a word is picked up and set down over this much travel
const CLEAR = 0.012; // past the edge by this much, a word is gone
// The gutter kept between a word of one sleeve and one of the next: about a
// word space at the larger of the two sizes.
const gutter = (p, q) => clamp(0.24 * Math.max(p.w ? p.w.s : 0, q.w ? q.w.s : 0), 0.03, 0.08);
const NICK = 0.15; // an edge taking less than this of a word reads as a mistake
const TS = 0.02; // plan resolution
const soft = (d) => (d <= 0 ? 0 : d < SOFT ? (d * d) / (2 * SOFT) : d - SOFT / 2);
const softInv = (x) => (x <= 0 ? 0 : x < SOFT / 2 ? Math.sqrt(2 * SOFT * x) : x + SOFT / 2);

// The part of a box that is on the square; null when none is.
const onSquare = (b) => {
  const c = [Math.max(0, b[0]), Math.max(0, b[1]), Math.min(1, b[2]), Math.min(1, b[3])];
  return c[2] > c[0] && c[3] > c[1] ? c : null;
};
// How much of two boxes overlap.
const shared = (a, b) => (a && b ? Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1])) : 0);
const grow = (b, p) => b && [b[0] - p, b[1] - p, b[2] + p, b[3] + p];
// A box's extent along the push, and the box carried o along it.
const along = (b, pv) => (pv[0] < 0 ? [1 - b[2], 1 - b[0]] : pv[0] > 0 ? [b[0], b[2]] : pv[1] < 0 ? [1 - b[3], 1 - b[1]] : [b[1], b[3]]);
const carry = (b, pv, o) => [b[0] + pv[0] * o, b[1] + pv[1] * o, b[2] + pv[0] * o, b[3] + pv[1] * o];

// The stretch of plan time over which a scheduled piece is moving.
const life = (e) => (e.out ? [e.t, e.t + softInv(1 + CLEAR - e.q[0])] : [e.t - softInv(e.q[1] + CLEAR), e.t]);
// Where element e of the plan sits at plan time t, as travel along the push.
// An outgoing piece rests until it is picked up at e.t; an incoming one is
// set down at e.t. A piece not yet planned is at rest (outgoing) or absent.
const offsetAt = (e, t) => (e.out ? (e.t == null ? 0 : soft(t - e.t)) : e.t == null ? -Infinity : -soft(e.t - t));
// Its state there: the box, how much of its length the push edges take,
// whether it is whole (a title word the edges take no more of than its own
// sleeve does: a word set bigger than the square counts while it shows at
// least as much of itself as it does at rest) and whether it is nicked
// (caught by an edge, but only just: the frame that reads as a mistake).
function stateOf(e, o, pv) {
  const box = carry(e.box, pv, o);
  const vis = onSquare(box);
  if (!vis) return { box, vis };
  const [q0, q1] = e.q;
  const cut = 1 - (Math.min(1, q1 + o) - Math.max(0, q0 + o)) / (q1 - q0);
  const moved = Math.abs(o) > 1e-4;
  return { box, vis, cut, moved, whole: e.title && (!moved || cut <= e.rest + 0.003), nicked: moved && cut > 0.003 && cut < NICK };
}

// The stretches of travel over which a piece is nicked, found once, and the
// plan times they fall at once the piece is scheduled.
function nickSpans(e, pv) {
  const out = [];
  const [lo, hi] = e.out ? [0, 1 + CLEAR - e.q[0]] : [-(e.q[1] + CLEAR), 0];
  let open = null;
  for (let o = lo; o <= hi + 1e-9; o += 0.001) {
    const st = stateOf(e, o, pv);
    const n = !!(st.vis && st.nicked);
    if (n && open == null) open = o;
    if (!n && open != null) {
      out.push([open, o]);
      open = null;
    }
  }
  if (open != null) out.push([open, hi]);
  return out;
}
const nickTimes = (e) => e.nicks.map(([a, b]) => (e.out ? [e.t + softInv(a), e.t + softInv(b)] : [e.t - softInv(-a), e.t - softInv(-b)]).sort((x, y) => x - y));

// Plan the push from sleeve A to sleeve B along pv. Outgoing words are picked
// up front first and incoming words set down front first, each as early as
// it can go without touching a word of the other sleeve and without a second
// word being nicked at the same moment. A colour field travels as one piece
// with the knocked-out words in it. If that leaves a moment with no whole
// title word on the square, the last title word out is held back until an
// incoming one has arrived.
function planPush(A, B, pv) {
  const make = (S, out) => {
    const els = S.words.map((w, i) => {
      const box = S.boxes[i];
      const q = along(box, pv);
      const e = { out, i, w, box, q, title: i < 3, knock: !w.k };
      e.rest = stateOf({ ...e, rest: 0 }, 0, pv).cut || 0;
      e.nicks = nickSpans(e, pv);
      return e;
    });
    els.sort((a, b) => b.q[1] - a.q[1] || a.i - b.i);
    let block = null;
    if (S.block && S.block !== (out ? B.block : A.block)) {
      const r = S.block;
      const box = [r.x, r.y, r.x + r.w, r.y + r.h];
      const inside = els.filter((e) => !e.w.k && !e.w.c && shared(e.box, box) > 0);
      block = { out, block: true, box, q: along(box, pv), inside, knock: true };
    }
    return { els, block };
  };
  const run = (hold) => {
    const a = make(A, true);
    const b = make(B, false);
    const all = [...a.els, ...b.els];
    if (a.block) all.push(a.block);
    if (b.block) all.push(b.block);
    // Rest overlaps inside one sleeve are allowed; between sleeves, none.
    const restShared = (p, q) => shared(onSquare(p.box), onSquare(q.box)) + 1e-5;
    const clash = (p, q, sp, sq) => {
      if (p.out === q.out) return !p.block && !q.block && shared(sp.vis, sq.vis) > restShared(p, q);
      // A colour field only clashes with words that print no black.
      if (p.block || q.block) return (p.block ? q : p).knock && shared(grow(sp.vis, gutter(p, q)), sq.vis) > 1e-5;
      return shared(grow(sp.vis, gutter(p, q)), sq.vis) > 1e-5;
    };
    const fits = (e) => {
      const [t0, t1] = life(e);
      for (let t = Math.max(0, t0); t <= t1 + 1e-9; t += TS / 2) {
        const se = stateOf(e, offsetAt(e, t), pv);
        if (!se.vis) continue;
        for (const f of all) {
          if (f === e || (f.t == null && !f.out)) continue;
          const sf = stateOf(f, offsetAt(f, t), pv);
          if (sf.vis && clash(e, f, se, sf)) return false;
        }
      }
      // A thin word can cross an edge between two samples, so the moments
      // it is nicked are kept apart exactly.
      if (e.block) return true;
      const mine = nickTimes(e);
      for (const f of all) {
        if (f === e || f.block || f.t == null) continue;
        for (const [a0, a1] of mine) for (const [b0, b1] of nickTimes(f)) if (a0 < b1 + TS / 4 && b0 < a1 + TS / 4) return false;
      }
      return true;
    };
    const place = (e, from) => {
      for (e.t = from; !fits(e); e.t += TS) if (e.t > 12) break;
    };
    // Outgoing, front first.
    let t = 0;
    const lastTitle = a.els.filter((e) => e.title).pop();
    for (const e of a.els) {
      let from = t;
      if (e === lastTitle) from = Math.max(from, hold);
      if (a.block && a.block.inside.includes(e)) from = Math.max(from, 0);
      place(e, from);
      t = e.t;
    }
    if (a.block) {
      const r = a.block;
      r.t = Math.max(0, ...r.inside.map((e) => e.t - (e.q[0] - r.q[0]) + 0.01));
    }
    // Incoming, front first, none before the first word has started to leave.
    const firstOff = Math.min(...a.els.map((e) => e.t + softInv(Math.max(0, 1 - e.q[1]))));
    if (b.block) {
      const r = b.block;
      place(r, Math.max(softInv(r.q[1] + CLEAR), firstOff + softInv(r.q[1])));
    }
    // Words of one lane arrive front first because they may not pass
    // through each other; words of different lanes arrive as soon as they can.
    for (const e of b.els) {
      let from = Math.max(softInv(e.q[1] + CLEAR), firstOff + softInv(e.q[1]));
      if (b.block && b.block.inside.includes(e)) from = Math.max(from, b.block.t);
      place(e, from);
    }
    const end = Math.max(...all.map((e) => life(e)[1]));
    return { all, a, b, end, pv };
  };
  // Hold the last title word out until the title is never missing.
  let plan = null;
  for (let hold = 0; hold <= 3; hold += 0.1) {
    plan = run(hold);
    if (wholeThroughout(plan)) break;
  }
  return squeeze(plan);
}
// Holding a word back can leave stretches where nothing on the square
// moves, and a drag through one would push nothing. Every piece is either
// done before such a stretch or starts after it, so the stretch is cut out,
// keeping only a beat, and the frames either side are exactly what they
// were.
const BEAT = 0.05;
function squeeze(plan) {
  const lives = plan.all.filter((e) => e.t != null).map(life).sort((a, b) => a[0] - b[0]);
  const gaps = [];
  let reach = 0;
  for (const [a, b] of lives) {
    if (a > reach + 1e-6) gaps.push([reach, a, reach === 0 ? 0 : BEAT]);
    reach = Math.max(reach, b);
  }
  for (const [a, b, keep] of gaps.reverse()) {
    const cut = b - a - keep;
    if (cut <= 1e-6) continue;
    for (const e of plan.all) if (e.t != null && life(e)[0] >= b - 1e-6) e.t -= cut;
    plan.end -= cut;
  }
  plan.squeezed = gaps.reduce((n, [a, b, keep]) => n + Math.max(0, b - a - keep), 0);
  return plan;
}
function wholeThroughout(plan) {
  for (let t = 0; t <= plan.end; t += TS / 2) if (!plan.all.some((e) => !e.block && stateOf(e, offsetAt(e, t), plan.pv).whole)) return false;
  return true;
}
// Plan time at playhead u.
const planTime = (plan, u) => clamp((u - PUSH[0]) / (PUSH[1] - PUSH[0]), 0, 1) * plan.end;

// The check, at the resolution a reviewer would scrub at: from u = 0 to 1 in
// steps of 0.05, at least one whole title word is on the square, and no more
// than one piece (the word in hand, crossing an edge) is cut by an edge by
// less than NICK of its length. Returns the failures.
function auditPlan(plan, step = 0.05) {
  const bad = [];
  for (let k = 0; k <= Math.round(1 / step); k++) {
    const u = k * step;
    const t = planTime(plan, u);
    const st = plan.all.filter((e) => !e.block).map((e) => ({ e, s: stateOf(e, offsetAt(e, t), plan.pv) }));
    const whole = st.filter(({ s }) => s.vis && s.whole).length;
    const nicked = st.filter(({ s }) => s.vis && s.nicked);
    if (!whole) bad.push({ u: +u.toFixed(2), why: "no whole title word" });
    if (nicked.length > 1) bad.push({ u: +u.toFixed(2), why: `${nicked.length} words nicked` });
  }
  return bad;
}

// ---------------------------------------------------------------- plates
function noiseCanvas(w, h, draw) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const g = c.getContext("2d");
  draw(g, w, h);
  return c;
}

// Separate one portrait into two screened plates and print them, multiplied,
// onto one canvas. The source panels are only 177px square, so a smooth
// enlargement goes soft; instead each plate is broken into a halftone screen
// whose cell spans just over one source pixel. Every dot is drawn at device
// resolution, so the picture carries all the detail the scan has and none it
// doesn't. Colour screen at 75 degrees, black at 45, the duotone standard.
const SRC = 177;
const CELL_SRC = 1.1; // source pixels per halftone cell
function separate(pixels, stride, rect, px) {
  // Luminance of the panel at its native resolution.
  const [rx, ry, rw, rh] = rect;
  const lumS = new Float32Array(rw * rh);
  const hist = new Uint32Array(256);
  for (let y = 0; y < rh; y++)
    for (let x = 0; x < rw; x++) {
      const o = ((ry + y) * stride + rx + x) * 4;
      const l = (0.2126 * pixels[o] + 0.7152 * pixels[o + 1] + 0.0722 * pixels[o + 2]) / 255;
      lumS[y * rw + x] = l;
      hist[Math.min(255, (l * 255) | 0)]++;
    }
  const pct = (q) => {
    let acc = 0;
    for (let i = 0; i < 256; i++) if ((acc += hist[i]) >= rw * rh * q) return i / 255;
    return 1;
  };
  const lo = pct(0.015);
  const hi = pct(0.985);
  // Bilinear sampling coordinates, per column and per row.
  const axis = (len) => {
    const i0 = new Int32Array(px);
    const f = new Float32Array(px);
    for (let j = 0; j < px; j++) {
      const sxy = clamp(((j + 0.5) * len) / px - 0.5, 0, len - 1.001);
      i0[j] = sxy | 0;
      f[j] = sxy - i0[j];
    }
    return [i0, f];
  };
  const [xi, xf] = axis(rw);
  const [yi, yf] = axis(rh);
  const cell = (px / SRC) * CELL_SRC;
  const aa = (cell / Math.PI) * 0.7; // spot-function slope, about one pixel wide
  // Tone curves and the cosine, as tables: this runs over a million pixels.
  const LV = 1024;
  const covT = new Float32Array(LV);
  const kT = new Float32Array(LV);
  for (let i = 0; i < LV; i++) {
    const l = i / (LV - 1);
    covT[i] = 1 - 2 * Math.pow(clamp((1 - l) * 1.12, 0, 1), 0.85);
    kT[i] = 1 - 2 * Math.pow(clamp((0.5 - l) / 0.46, 0, 1), 1.35) * 0.96;
  }
  const CS = 4096;
  const cosT = new Float32Array(CS);
  for (let i = 0; i < CS; i++) cosT[i] = Math.cos((2 * Math.PI * i) / CS) / 2;
  const cosF = (u) => cosT[((u - Math.floor(u)) * CS) | 0];
  // Screen axes per pixel: colour at 75 degrees, black at 45.
  const axes = (deg) => {
    const r = (deg * Math.PI) / 180;
    return [Math.cos(r) / cell, Math.sin(r) / cell];
  };
  const [cc, cs] = axes(75);
  const [kc, ks] = axes(45);
  const ink = (spot, t) => {
    if (t >= 0.996) return 0;
    if (t <= -0.996) return 1;
    const v = (spot - t) * aa + 0.5;
    return v <= 0 ? 0 : v >= 1 ? 1 : v;
  };
  const span = Math.max(0.05, hi - lo);
  const out = new ImageData(px, px);
  const d = out.data;
  const kInk = 1 - BLACK[0] / 255;
  for (let y = 0; y < px; y++) {
    const yy = y + 0.5;
    const r0 = yi[y] * rw;
    const r1 = r0 + rw;
    const fy = yf[y];
    for (let x = 0; x < px; x++) {
      const xx = x + 0.5;
      const i = y * px + x;
      const c0 = xi[x];
      const fx = xf[x];
      const top = lumS[r0 + c0] + (lumS[r0 + c0 + 1] - lumS[r0 + c0]) * fx;
      const bot = lumS[r1 + c0] + (lumS[r1 + c0 + 1] - lumS[r1 + c0]) * fx;
      let l = (top + (bot - top) * fy - lo) / span;
      l = l < 0 ? 0 : l > 1 ? 1 : l;
      const li = (l * (LV - 1)) | 0;
      const dc = ink(cosF(xx * cc + yy * cs) + cosF(-xx * cs + yy * cc), covT[li]);
      const dk = ink(cosF(xx * kc + yy * ks) + cosF(-xx * ks + yy * kc), kT[li]);
      const kv = 1 - dk * kInk;
      const o = i * 4;
      d[o] = (255 - dc * (255 - COLOUR[0])) * kv;
      d[o + 1] = (255 - dc * (255 - COLOUR[1])) * kv;
      d[o + 2] = (255 - dc * (255 - COLOUR[2])) * kv;
      d[o + 3] = 255;
    }
  }
  return noiseCanvas(px, px, (g) => g.putImageData(out, 0, 0));
}

// Board: warm white with fibre and tooth.
function makeBoard(px) {
  return noiseCanvas(px, px, (g, w, h) => {
    const img = g.createImageData(w, h);
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < w * h; i++) {
      const v = (rnd() - 0.5) * 7;
      img.data[i * 4] = BOARD[0] + v;
      img.data[i * 4 + 1] = BOARD[1] + v;
      img.data[i * 4 + 2] = BOARD[2] + v * 0.9;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // Fibres: short, faint, mostly along the grain.
    for (let i = 0; i < (w * h) / 900; i++) {
      const x = rnd() * w;
      const y = rnd() * h;
      const len = (4 + rnd() * 14) * (w / 1000);
      const a = (rnd() - 0.5) * 0.7;
      g.strokeStyle = rnd() < 0.5 ? "rgba(120,100,70,0.06)" : "rgba(255,255,255,0.35)";
      g.lineWidth = Math.max(0.6, w / 1600);
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
      g.stroke();
    }
  });
}

// Ink film: a solid laid on board is flat, so there is no cloud in it, only
// the board's tooth showing through at the scale of its fibres, and
// pinholes where the tooth broke the film. Screened over the print, so it
// only lifts the inks.
function makeWear(px) {
  return noiseCanvas(px, px, (g, w, h) => {
    const img = g.createImageData(w, h);
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < w * h; i++) {
      const r = rnd();
      const v = r * r * 14;
      img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    for (let i = 0; i < (w * h) / 320; i++) {
      const v = 40 + rnd() * 90;
      g.fillStyle = `rgb(${v},${v},${v})`;
      const r = (0.4 + rnd() * 0.9) * (w / 1200);
      g.fillRect(rnd() * w, rnd() * h, r, r);
    }
  });
}

// ---------------------------------------------------------------- engine
export async function createSleeve(host) {
  const stage = createStage(host, { dpr: 2 });
  const { ctx, canvas } = stage;
  const params = new URLSearchParams(location.search);

  const family = getComputedStyle(document.body).getPropertyValue("--font-geist-sans").trim() || "Geist, sans-serif";
  const [img] = await Promise.all([
    loadCover("let-it-be"),
    Promise.race([
      Promise.all([document.fonts.load(`${WEIGHT} 100px ${family}`), document.fonts.load(`${CREDIT_WEIGHT} 100px ${family}`)]),
      new Promise((r) => setTimeout(r, 1500)),
    ]).catch(() => null),
  ]);
  // Plates are screened at the size they print, so they are rebuilt when the
  // sleeve changes size. The largest crop any layout takes is 1.06 sleeves.
  const pixels = noiseCanvas(img.naturalWidth, img.naturalHeight, (g) => g.drawImage(img, 0, 0))
    .getContext("2d")
    .getImageData(0, 0, img.naturalWidth, img.naturalHeight).data;
  let plates = [];
  let PLATE = 0;
  const buildPlates = (px) => {
    if (px === PLATE) return;
    PLATE = px;
    plates = PANELS.map((r) => separate(pixels, img.naturalWidth, r, px));
  };

  // Advance widths and ink boxes per unit size, with the tracking law at a
  // large size.
  const REF = 400;
  const meas = document.createElement("canvas").getContext("2d");
  const metric = (i) => {
    meas.font = `${weightOf(i)} ${REF}px ${family}`;
    meas.letterSpacing = `${tracking(REF)}px`;
    const t = meas.measureText(TEXT[i]);
    return { w: t.width / REF, l: t.actualBoundingBoxLeft / REF, r: t.actualBoundingBoxRight / REF, a: t.actualBoundingBoxAscent / REF, d: t.actualBoundingBoxDescent / REF };
  };
  const metrics = TEXT.map((_, i) => metric(i));
  const adv = { let: metrics[0].w, it: metrics[1].w, be: metrics[2].w };
  const sleeves = layouts(adv).map((L, idx) => {
    const words = [...L.words, L.credit];
    const boxes = words.map((w, i) => wordBox(w, metrics[i]));
    return { ...L, idx, words, boxes };
  });
  // Each handoff is planned once, ahead of time where the browser has a
  // spare moment, otherwise the first time it is played.
  const plans = new Map();
  const planFor = (A, B, pv) => {
    const key = `${A.idx}>${B.idx}:${pv}`;
    if (!plans.has(key)) plans.set(key, planPush(A, B, pv));
    return plans.get(key);
  };
  // Every handoff on the torus, both ways along both axes. The push runs
  // against the step: the sleeve to the right is reached by pushing left.
  const handoffs = [];
  for (const A of sleeves)
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ax = A.idx % COLS;
      const ay = Math.floor(A.idx / COLS);
      const B = sleeves[(((ay + dy) % ROWS) + ROWS) % ROWS * COLS + ((((ax + dx) % COLS) + COLS) % COLS)];
      handoffs.push({ A, B, pv: [-dx, -dy], label: `${A.idx}>${B.idx} ${dx + dy > 0 ? "+" : "-"}${dx ? "x" : "y"}` });
    }
  let alive = true;
  const idle = window.requestIdleCallback ? (f) => window.requestIdleCallback(f, { timeout: 400 }) : (f) => setTimeout(f, 30);
  const planAhead = (k) => {
    if (!alive || k >= handoffs.length) return;
    const { A, B, pv } = handoffs[k];
    planFor(A, B, pv);
    idle(() => planAhead(k + 1));
  };
  // ?check audits every handoff.
  if (params.has("check")) {
    const report = [];
    const t0 = performance.now();
    for (const { A, B, pv, label } of handoffs) {
      const plan = planFor(A, B, pv);
      const lastOut = Math.max(...plan.a.els.map((e) => e.t + softInv(1 + CLEAR - e.q[0])));
      const firstIn = Math.min(...plan.b.els.map((e) => e.t - softInv(e.q[1])));
      if (params.get("check") === "v") console.log(`plan ${label}`, plan.all.map((e) => `${e.out ? "A" : "B"}${e.block ? "block" : TEXT[e.i]}@${e.t.toFixed(2)} q${e.q.map((v) => v.toFixed(2))}`).join(" | "));
      report.push({ pair: label, end: +plan.end.toFixed(2), squeezed: +plan.squeezed.toFixed(2), overlap: firstIn < lastOut, bad: auditPlan(plan), fine: auditPlan(plan, 0.01) });
    }
    const failed = report.filter((r) => r.bad.length || !r.overlap);
    console.log(`blue-note check: ${report.length - failed.length}/${report.length} handoffs pass, planned in ${Math.round(performance.now() - t0)}ms`, JSON.stringify(report));
    host.dataset.check = failed.length ? "fail" : "pass";
  }
  // Which pair of crop edges moves first: the order whose first move runs
  // the picture under less of the outgoing words, which are still there.
  const firstEdges = (A, B) => {
    const a = A.photo;
    const b = B.photo;
    const under = (x, y, w, h) => A.boxes.reduce((n, box) => n + shared(onSquare(box), [x, y, x + w, y + h]), 0);
    const ux = under(b.x, a.y, b.w, a.h);
    const uy = under(a.x, b.y, a.w, b.h);
    return Math.abs(ux - uy) < 1e-4 ? axis : ux < uy ? "x" : "y";
  };

  // ------------------------------------------------------------ playhead
  // The sleeve the playhead counts from, the axis it runs along, and how far
  // along it is (in sleeves) now and where it is headed.
  const base = { x: 0, y: 0 };
  let axis = "x";
  let P = 0;
  let Q = 0;
  const held = params.get("t");
  if (params.has("c")) {
    const c = +params.get("c") | 0;
    base.x = c % COLS;
    base.y = Math.floor(c / COLS) % ROWS;
  }
  if (held != null) {
    const [tx, ty = "0"] = held.split(",").map((v) => +v || 0);
    axis = Math.abs(ty) > Math.abs(tx) ? "y" : "x";
    P = Q = axis === "x" ? tx : ty;
  }
  const mod = (a, n) => ((a % n) + n) % n;
  const sleeveAt = (x, y) => sleeves[mod(y, ROWS) * COLS + mod(x, COLS)];
  const atRest = () => Math.abs(P - Q) < 1e-4 && Math.abs(Q - Math.round(Q)) < 1e-6;
  // Count from wherever the playhead has landed, along a new axis.
  const rebase = (next) => {
    const n = Math.round(Q);
    if (axis === "x") base.x += n;
    else base.y += n;
    P = Q = 0;
    axis = next;
  };

  // The sleeve as printed at playhead p: which two sleeves, and how far
  // through the handoff from the first to the second.
  const frameAt = (p) => {
    const dir = p < 0 ? -1 : 1;
    const whole = Math.floor(Math.abs(p) + 1e-6);
    const u = Math.abs(p) - whole;
    const step = (k) => (axis === "x" ? sleeveAt(base.x + dir * k, base.y) : sleeveAt(base.x, base.y + dir * k));
    // The push runs the way the finger does: a drag toward -x carries the
    // type toward -x.
    const pv = axis === "x" ? [-dir, 0] : [0, -dir];
    return { A: step(whole), B: step(whole + 1), u: u < 1e-5 ? 0 : u, pv };
  };

  // ------------------------------------------------------------ layers
  const layerC = document.createElement("canvas");
  const layerK = document.createElement("canvas");
  const lc = layerC.getContext("2d");
  const lk = layerK.getContext("2d");
  let S = 1;
  let ox = 0;
  let oy = 0;
  let board = null;
  let wear = null;
  let dirty = true;
  stage.onResize((w, h, dpr) => {
    S = Math.round(Math.min(w * 0.82, h * 0.74, 720));
    ox = Math.round((w - S) / 2);
    oy = Math.round((h - S) / 2);
    const px = Math.round(S * dpr);
    for (const c of [layerC, layerK]) {
      c.width = px;
      c.height = px;
    }
    board = makeBoard(px);
    wear = makeWear(px);
    buildPlates(Math.min(1600, Math.ceil(px * 1.06)));
    dirty = true;
  });

  // ------------------------------------------------------------ input
  let drag = null;
  let lift = 0;
  let liftV = 0;
  const inside = (p) => p.x >= ox && p.x <= ox + S && p.y >= oy && p.y <= oy + S;
  stage.on("down", (p) => {
    if (!inside(p)) return;
    // Grab the playhead where it is; only a landed sleeve can turn the axis.
    const free = atRest();
    if (free) rebase(axis);
    drag = { x: p.x, y: p.y, from: P, free };
    Q = P;
    canvas.style.cursor = "grabbing";
  });
  stage.on("move", (p) => {
    if (drag) {
      const dx = p.x - drag.x;
      const dy = p.y - drag.y;
      if (drag.free && Math.hypot(dx, dy) > 6) {
        axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
        drag.free = false;
      }
      if (!drag.free) Q = drag.from - (axis === "x" ? dx : dy) / (S * STEP);
    } else canvas.style.cursor = inside(p) ? "grab" : "";
  });
  stage.on("up", (p) => {
    if (!drag) return;
    // Throw: project the release velocity, then land on a sleeve at most one
    // away from where the drag started... unless dragged far.
    const v = axis === "x" ? p.vx : p.vy;
    const r = Math.round(Q - (v * 0.16) / (S * STEP));
    const start = Math.round(drag.from);
    Q = Math.abs(Q - drag.from) < 1.2 ? clamp(r, start - 1, start + 1) : r;
    drag = null;
    canvas.style.cursor = inside(p) ? "grab" : "";
  });

  // Left alone for five seconds, it keeps setting new sleeves.
  let nextIdle = 5;
  const TOUR = [
    ["x", 1],
    ["x", 1],
    ["y", 1],
    ["x", -1],
    ["x", -1],
    ["y", -1],
  ];
  let tourAt = 0;

  // ------------------------------------------------------------ draw
  const drawPhoto = (l, ph) => {
    const { x, y, w, h, fx, fy, z, p } = ph;
    if (w < 0.002 || h < 0.002) return;
    const s = Math.max(w, h) * Math.max(1, z);
    const uw = Math.min(1, w / s);
    const uh = Math.min(1, h / s);
    const u0 = clamp(fx - uw / 2, 0, 1 - uw);
    const v0 = clamp(fy - uh / 2, 0, 1 - uh);
    l.drawImage(plates[p], u0 * PLATE, v0 * PLATE, uw * PLATE, uh * PLATE, x * S, y * S, w * S, h * S);
  };
  const drawWord = (l, which, i, w, d) => {
    const px = w.s * S;
    if (px < 1) return;
    // A plate prints a word or knocks it out; a word neither plate prints is
    // reversed out of the ink beneath it.
    const on = which === "k" ? w.k : w.c;
    l.save();
    l.translate((w.x + d[0]) * S, (w.y + d[1]) * S);
    l.rotate((w.r * Math.PI) / 180);
    l.scale(w.sx, 1);
    l.font = `${weightOf(i)} ${px}px ${family}`;
    l.letterSpacing = `${tracking(px)}px`;
    l.fillStyle = !on ? "#fff" : which === "k" ? `rgb(${BLACK.join(",")})` : `rgb(${COLOUR.join(",")})`;
    l.fillText(TEXT[i], 0, 0);
    l.restore();
  };
  // A field of colour is one piece of the push, carried with the words
  // reversed out of it.
  const drawBlock = (l, which, b, d = [0, 0]) => {
    if (!b) return;
    l.fillStyle = which === "c" ? `rgb(${COLOUR.join(",")})` : "#fff";
    l.fillRect((b.x + d[0]) * S, (b.y + d[1]) * S, b.w * S, b.h * S);
  };
  // The crop moves first, one pair of edges at a time, so the picture always
  // shares a line with one of the two sleeves; the portrait on the press
  // changes as the second pair starts to move.
  const photoAt = (A, B, u) => {
    const a = A.photo;
    const b = B.photo;
    const pu = span(u, 0, PHOTO_END);
    const first = smoother(clamp(pu * 2, 0, 1));
    const second = smoother(clamp(pu * 2 - 1, 0, 1));
    const [m1, m2] = firstEdges(A, B) === "x" ? [first, second] : [second, first];
    const src = pu < 0.5 ? a : b;
    return {
      x: lerp(a.x, b.x, m1),
      w: lerp(a.w, b.w, m1),
      y: lerp(a.y, b.y, m2),
      h: lerp(a.h, b.h, m2),
      fx: src.fx,
      fy: src.fy,
      z: src.z,
      p: src.p,
    };
  };
  const drawPlate = (l, which, dpr, { A, B, u, pv }) => {
    l.setTransform(dpr, 0, 0, dpr, 0, 0);
    l.globalAlpha = 1;
    l.fillStyle = "#fff";
    l.fillRect(0, 0, S, S);
    const still = [0, 0];
    if (u === 0) {
      if (which === "c") drawPhoto(l, A.photo);
      drawBlock(l, which, A.block);
      A.words.forEach((w, i) => drawWord(l, which, i, w, still));
      return;
    }
    const plan = planFor(A, B, pv);
    const t = planTime(plan, u);
    const at = (e) => {
      const o = offsetAt(e, t);
      return [pv[0] * o, pv[1] * o];
    };
    // The crop moves under the colour field: the field is a piece of the
    // push and keeps the words reversed out of it.
    if (which === "c") drawPhoto(l, photoAt(A, B, u));
    if (A.block === B.block) drawBlock(l, which, A.block);
    else {
      if (plan.a.block) drawBlock(l, which, A.block, at(plan.a.block));
      if (plan.b.block) drawBlock(l, which, B.block, at(plan.b.block));
    }
    for (const e of plan.all) {
      if (e.block) continue;
      const d = at(e);
      if (Number.isFinite(d[0]) && Number.isFinite(d[1]) && onSquare(carry(e.box, pv, offsetAt(e, t)))) drawWord(l, which, e.i, e.w, d);
    }
  };

  stage.onFrame((dt, t) => {
    const { width: w, height: h, dpr } = stage;
    // Idle tour.
    if (!drag && held == null && stage.idleFor() > 5000) {
      if (t > nextIdle && atRest()) {
        const [ax, d] = TOUR[tourAt++ % TOUR.length];
        rebase(ax);
        Q = d;
        nextIdle = t + 3.2;
      }
    } else nextIdle = Math.max(nextIdle, t + 1.2);

    // The playhead walks toward where it is headed at the handoff's own pace,
    // easing in over the last few hundredths so a held drag stops softly.
    const P0 = P;
    if (held == null) {
      const vmax = dt / TOUR_S;
      P += clamp((Q - P) * Math.min(1, dt * 16), -vmax, vmax);
      if (Math.abs(Q - P) < 1e-4) P = Q;
    }

    // Lift while held.
    const liftGoal = drag ? 1 : 0;
    liftV += ((liftGoal - lift) * 300 - liftV * 2 * Math.sqrt(300)) * dt;
    lift += liftV * dt;

    // Nothing moving: the last frame is still the sleeve.
    const moving = P !== P0 || Math.abs(liftV) > 1e-3 || Math.abs(lift - liftGoal) > 1e-4;
    if (!moving && !dirty) return;
    dirty = false;

    const F = frameAt(P);
    drawPlate(lc, "c", dpr, F);
    drawPlate(lk, "k", dpr, F);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, w, h);

    const grow = 1 + lift * 0.006;
    ctx.save();
    ctx.translate(ox + S / 2, oy + S / 2);
    ctx.scale(grow, grow);
    ctx.translate(-S / 2, -S / 2);

    // Shadows: a wide soft one that grows with lift, and a tight contact one.
    ctx.save();
    ctx.fillStyle = GROUND;
    ctx.shadowColor = `rgba(60,45,25,${0.16 + lift * 0.04})`;
    ctx.shadowBlur = S * (0.07 + lift * 0.03);
    ctx.shadowOffsetY = S * (0.03 + lift * 0.015);
    ctx.fillRect(2, 2, S - 4, S - 4);
    ctx.shadowColor = "rgba(40,30,20,0.22)";
    ctx.shadowBlur = 2.5;
    ctx.shadowOffsetY = 1;
    ctx.fillRect(0, 0, S, S);
    ctx.restore();

    if (board) ctx.drawImage(board, 0, 0, S, S);
    ctx.globalCompositeOperation = "multiply";
    ctx.drawImage(layerC, 0, 0, S, S);
    // The black plate, a hair out of register.
    ctx.drawImage(layerK, 0.35, 0.25, S, S);
    ctx.globalCompositeOperation = "screen";
    if (wear) ctx.drawImage(wear, 0, 0, S, S);

    // Board edge: a lit top edge, a slightly dirty perimeter.
    ctx.globalCompositeOperation = "source-over";
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0.5, 0.5);
    ctx.lineTo(S - 0.5, 0.5);
    ctx.stroke();
    ctx.strokeStyle = "rgba(70,55,35,0.12)";
    ctx.strokeRect(0.25, 0.25, S - 0.5, S - 0.5);
    ctx.restore();
  });

  idle(() => planAhead(0));

  return {
    destroy: () => {
      alive = false;
      stage.destroy();
    },
  };
}
