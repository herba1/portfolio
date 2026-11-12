// The history of a record with no sleeve, simulated rather than drawn.
//
// The record is a rigid disc. Every time it is handled it moves against
// something: the face of the record under it as it is slid out of a stack,
// the face of the record put down on top of it, a cloth, a fingertip, the
// spindle, a dropped stylus. Each of those events is a planar rigid motion,
// a turn about some pivot plus a translation, against a contact patch. Grit
// sits in the patch, each grain with its own size, hardness and the distance
// it lasts before it rolls out or breaks. A grain is fixed to the thing it is
// caught in, so its path across the vinyl is that position carried through
// the inverse of the record's motion: every grain in one event cuts a curve
// about the same instantaneous centre, and an event leaves a family of nested
// hairlines with a deep gouge or two among them. How deep a grain cuts is the
// load at that point of the patch times the grain's hardness.
//
// Where the load falls is what gives the record its history. The label stands
// proud of the vinyl, so whatever lies on the record is held off the grooves
// beside it, and they stay clean. A record pulled from a stack is lifted at
// the edge it is held by and drags the opposite rim; one slid on top of it
// drags its own rim across the face. Fingers hold the edge. So the wear piles
// up at the rim and in the outer band where the lead-in is, and thins out
// toward the label.

export const LABEL = 0.331;
export const HAIR = 0.0009; // half width of a fine hairline, in record radii
const TAU = Math.PI * 2;

// A deterministic generator for the seeded history.
export function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sat = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (a, b, x) => {
  const t = sat((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const gauss = (rand) => (rand() + rand() + rand() - 1.5) * 1.41;

// The label's step holds a flat face off the vinyl next to it; it bends down
// to touch a few centimetres out. The rim bead and the lead-in stand proudest
// after it, so a flat face bears on them hardest.
export const bearing = (r) => 0.3 + 0.7 * smooth(0.5, 0.95, r);
export const shield = (r) => smooth(LABEL + 0.03, LABEL + 0.4, r);

// One grain of grit. Most of what is on a record is soft dust that leaves a
// hairline; now and then a grain of sand, which ploughs.
export function grain(rand, { hard = 0.06, life = 0.25, big = 0 } = {}) {
  const sand = rand() < hard;
  return {
    size: HAIR * (0.42 + 0.45 * rand() + (sand ? 0.3 + 0.9 * rand() ** 2 : 0) + big),
    hard: sand ? 0.6 + 0.4 * rand() : 0.07 + 0.3 * rand() ** 1.5,
    life: -Math.log(1 - rand() * 0.995) * life * (sand ? 1.6 : 1),
    seed: rand() * 100,
    wob: rand() * TAU,
  };
}

// A grain riding a contact: it touches down, cuts while it is loaded, lifts
// where the load goes, and is gone once it has travelled its life.
export function rider(g) {
  return { g, tail: null, run: 0, done: false };
}

// Stamps one step of a grain's path. `cut(x0, y0, x1, y1, hw, depth, burr,
// seed)` receives each segment in record-local coordinates.
export function ride(st, x, y, load, cut, lo = LABEL + 0.006, hi = 0.992) {
  if (st.done) return;
  const r = Math.hypot(x, y);
  if (r < lo || r > hi || load < 0.015) {
    st.tail = null;
    return;
  }
  const g = st.g;
  if (!st.tail) {
    st.tail = [x, y];
    return;
  }
  const dx = x - st.tail[0];
  const dy = y - st.tail[1];
  const len = Math.hypot(dx, dy);
  if (len < 0.0022) return;
  const run = st.run + len;
  // A cut comes in light and runs out light as the grain rolls free.
  const env = smooth(0, 0.012, run) * smooth(0, 0.03, g.life - st.run);
  // A grain rolls a little as it goes, so the line is never ruled.
  const w = 0.00025 * Math.sin(run * 90 + g.wob) * (g.hard > 0.5 ? 0.4 : 1);
  const nx = (-dy / len) * w;
  const ny = (dx / len) * w;
  const depth = Math.min(1, load * g.hard * env);
  const hw = g.size * (0.7 + 0.45 * Math.min(1, load)) * (0.55 + 0.45 * env);
  const to = [x + nx, y + ny];
  if (depth > 0.01) cut(st.tail[0], st.tail[1], to[0], to[1], hw, depth, Math.min(1, 0.1 + depth * 0.85), g.seed);
  st.tail = to;
  st.run = run;
  if (run > g.life) st.done = true;
}

// A rigid motion sampled along the event: pose(s) gives the turn and the
// shift that take record coordinates to the table at s in 0..1.
const pose = (phi, tx, ty) => ({ c: Math.cos(phi), s: Math.sin(phi), tx, ty });
// A turn about a pivot `p` (on the table) by phi, then a shift.
const about = (phi, px, py, sx, sy) => {
  const c = Math.cos(phi);
  const s = Math.sin(phi);
  return { c, s, tx: px - (c * px - s * py) + sx, ty: py - (s * px + c * py) + sy };
};
const apply = (P, x, y) => [P.c * x - P.s * y + P.tx, P.s * x + P.c * y + P.ty];
const inverse = (P, x, y) => {
  const ux = x - P.tx;
  const uy = y - P.ty;
  return [P.c * ux + P.s * uy, -P.s * ux + P.c * uy];
};

// Runs one event: the record's motion `rec(s)`, the patch's motion `body(s)`
// (the grit's carrier, fixed on the table unless it moves too), grains fixed
// in the carrier at `at`, and the load at a point of the patch.
function run(ev, cut) {
  const n = ev.steps;
  for (const gr of ev.grains) gr.st = rider(gr.g);
  for (let i = 0; i <= n; i += 1) {
    const s = i / n;
    const R = ev.rec(s);
    const B = ev.body ? ev.body(s) : null;
    for (const gr of ev.grains) {
      if (gr.st.done || s < gr.from || s > gr.to) {
        gr.st.tail = null;
        continue;
      }
      const [wx, wy] = B ? apply(B, gr.at[0], gr.at[1]) : gr.at;
      const [lx, ly] = inverse(R, wx, wy);
      const load = ev.load(gr, lx, ly, s);
      ride(gr.st, lx, ly, load, cut, ev.lo, ev.hi);
    }
  }
}

// Dust is never spread evenly: it lies in drifts and smudges, a few to a
// face, and the grains of one drift travel together.
const drifts = (rand, n, cx, cy, rad) => {
  const out = [];
  const k = 1 + Math.floor(rand() * 3);
  const cs = [];
  for (let i = 0; i < k; i += 1) cs.push([...inDisc(rand, cx, cy, rad), 0.025 + rand() ** 2 * 0.16]);
  for (let i = 0; i < n; i += 1) {
    const c = cs[Math.floor(rand() * k)];
    out.push(inDisc(rand, c[0], c[1], c[2]));
  }
  return out;
};

const steps = (travel) => Math.max(8, Math.ceil(travel / 0.0035));
const inDisc = (rand, cx, cy, rad) => {
  const a = rand() * TAU;
  const r = rad * Math.sqrt(rand());
  return [cx + Math.cos(a) * r, cy + Math.sin(a) * r];
};

// Pulled out of a stack: held at the rim, lifted on that side, slid off the
// record beneath. The far rim drags, turning about the hand as it comes.
function pulled(rand, dusty) {
  const ga = rand() * TAU;
  const gx = Math.cos(ga) * 0.97;
  const gy = Math.sin(ga) * 0.97;
  const da = ga + gauss(rand) * 0.35;
  const D = 0.9 + rand() * 0.8;
  // The hand swings as it pulls: the record turns about the grip.
  const phi = (rand() < 0.5 ? -1 : 1) * (0.25 + rand() * 1.1);
  const span = 0.12 + rand() * 0.4;
  const press = 0.55 + 0.6 * rand();
  const ux = Math.cos(ga);
  const uy = Math.sin(ga);
  const grains = [];
  const ng = Math.round((3 + rand() * 10) * dusty);
  for (const at of drifts(rand, ng, 0, 0, 1)) grains.push({ g: grain(rand, { life: 0.12 + rand() * 0.25 }), at, from: 0, to: 1 });
  return {
    steps: steps(D + Math.abs(phi) * 2),
    rec: (s) => about(phi * s, gx, gy, Math.cos(da) * D * s, Math.sin(da) * D * s),
    load: (gr, lx, ly) => {
      const u = (1 - (lx * ux + ly * uy)) / 2; // 1 at the rim that drags
      const w = sat((u - (1 - span)) / span);
      return press * w * w * shield(Math.hypot(lx, ly));
    },
    grains,
  };
}

// Covered: another record slid onto this one, its leading rim dragging grit
// across the face until it comes to rest a little off true.
function covered(rand, dusty) {
  const da = rand() * TAU;
  const D = 1.9 + rand() * 0.4;
  const phi = (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 0.9);
  const ex = (rand() - 0.5) * 0.08;
  const ey = (rand() - 0.5) * 0.08;
  const span = 0.15 + rand() * 0.35;
  const press = 0.45 + 0.5 * rand();
  // The hand pushes from behind; the far edge of the record it holds leads.
  const lx0 = Math.cos(da);
  const ly0 = Math.sin(da);
  const grains = [];
  const ng = Math.round((6 + rand() * 16) * dusty);
  for (const at of drifts(rand, ng, 0, 0, 1)) {
    // Only grit near the leading rim of the record that is set down rides it.
    if ((1 + at[0] * lx0 + at[1] * ly0) / 2 < 1 - span * 1.4) continue;
    grains.push({ g: grain(rand, { life: 0.2 + rand() * 0.5 }), at, from: 0, to: 1 });
  }
  const px = -lx0 * 0.97;
  const py = -ly0 * 0.97;
  return {
    steps: steps(D + Math.abs(phi) * 2),
    rec: () => pose(0, 0, 0),
    // The other record: from off to one side, turning about the hand, to rest.
    body: (s) => {
      const e = 1 - s;
      return about(-phi * e, px, py, ex - lx0 * D * e, ey - ly0 * D * e);
    },
    load: (gr, lx, ly) => {
      const u = (1 + gr.at[0] * lx0 + gr.at[1] * ly0) / 2;
      const w = sat((u - (1 - span)) / span);
      const r = Math.hypot(lx, ly);
      return press * w * shield(r) * bearing(r);
    },
    grains,
  };
}

// Wiped: a cloth pressed on with the flat of the fingers, the record turned
// against it in the other hand, round a wrist that is never quite on the
// spindle. Sometimes a straight scrub instead, back and forth.
function wiped(rand) {
  const ca = rand() * TAU;
  const cr = 0.5 + rand() * 0.38;
  const cx = Math.cos(ca) * cr;
  const cy = Math.sin(ca) * cr;
  const sig = 0.1 + rand() * 0.16;
  const press = 0.5 + 0.6 * rand();
  const grains = [];
  const ng = 6 + Math.floor(rand() * 26);
  for (let k = 0; k < ng; k += 1) {
    const a = rand() * TAU;
    const rr = sig * Math.sqrt(-Math.log(1 - rand() * 0.98)) * 0.9;
    const from = rand() * 0.5;
    grains.push({ g: grain(rand, { hard: 0.04, life: 0.25 + rand() * 0.9 }), at: [cx + Math.cos(a) * rr, cy + Math.sin(a) * rr], from, to: from + 0.3 + rand() * 0.7 });
  }
  const load = (gr, lx, ly) => {
    const dx = gr.at[0] - cx;
    const dy = gr.at[1] - cy;
    return press * Math.exp(-(dx * dx + dy * dy) / (sig * sig)) * shield(Math.hypot(lx, ly));
  };
  if (rand() < 0.72) {
    const pa = rand() * TAU;
    const pr = rand() ** 1.5 * 0.35;
    const px = Math.cos(pa) * pr;
    const py = Math.sin(pa) * pr;
    const phi = (rand() < 0.5 ? -1 : 1) * (0.5 + rand() * 2.6);
    const back = rand() < 0.35;
    return {
      steps: steps(Math.abs(phi) * (cr + pr) * (back ? 2 : 1)),
      rec: (s) => about(back ? phi * Math.sin(s * Math.PI) : phi * s, px, py, 0, 0),
      load,
      grains,
    };
  }
  const sa = rand() * TAU;
  const A = 0.25 + rand() * 0.45;
  const far = (rand() < 0.5 ? -1 : 1) * (1.5 + rand() * 4);
  const reps = 1 + Math.floor(rand() * 3);
  // A pivot far off to the side bends the scrub into a shallow arc.
  const qx = cx - Math.sin(sa) * far;
  const qy = cy + Math.cos(sa) * far;
  return {
    steps: steps(A * 2 * reps),
    rec: (s) => about((A / far) * Math.sin(s * Math.PI * reps), qx, qy, 0, 0),
    load,
    grains,
  };
}

// Held: fingertips on the face at the edge, the thumb on the rim. The record
// slips a little in the grip as it is lifted or turned over, about the other
// hand. Fingertips press hard over a small patch, and a nail now and then.
function held(rand) {
  const fa = rand() * TAU;
  const fr = 0.86 + rand() * 0.11;
  const fx = Math.cos(fa) * fr;
  const fy = Math.sin(fa) * fr;
  const pa = fa + Math.PI + gauss(rand) * 0.8;
  const pr = 0.6 + rand() * 0.9;
  const px = Math.cos(pa) * pr;
  const py = Math.sin(pa) * pr;
  const phi = (rand() < 0.5 ? -1 : 1) * (0.015 + rand() ** 2 * 0.14);
  const press = 0.8 + 0.5 * rand();
  const grains = [];
  const ng = 1 + Math.floor(rand() * 4);
  const nail = rand() < 0.12;
  for (let k = 0; k < ng; k += 1) {
    grains.push({ g: grain(rand, { hard: nail && k === 0 ? 1 : 0.14, life: 0.04 + rand() * 0.2, big: nail && k === 0 ? 0.8 : 0 }), at: inDisc(rand, fx, fy, 0.03), from: 0, to: 1 });
  }
  return {
    steps: steps(Math.abs(phi) * (pr + 1)),
    rec: (s) => about(phi * s, px, py, 0, 0),
    load: () => press,
    grains,
    hi: 0.995,
  };
}

// A stylus dropped on a turning record skates across it on the arm's arc,
// bouncing. The carrier is the arm; the record turns under it.
function skated(rand) {
  const aa = rand() * TAU;
  const ar = 1.32 + rand() * 0.12;
  const ax = Math.cos(aa) * ar;
  const ay = Math.sin(aa) * ar;
  const len = ar - 0.04 + rand() * 0.08;
  const t0 = aa + Math.PI - Math.acos(Math.min(1, (ar * ar + len * len - 0.9 * 0.9) / (2 * ar * len)));
  const swing = (rand() < 0.5 ? 1 : -1) * (0.08 + rand() * 0.2);
  const turn = -(0.25 + rand() * 0.7);
  const tip = [ax + Math.cos(t0) * len, ay + Math.sin(t0) * len];
  const g = { size: HAIR * (1.6 + rand() * 0.6), hard: 1, life: 0.3 + rand() * 0.4, seed: rand() * 100, wob: 0 };
  const hop = 3 + rand() * 6;
  return {
    steps: steps(Math.abs(turn) + Math.abs(swing) * len),
    rec: (s) => pose(turn * s, 0, 0),
    body: (s) => about(swing * s, ax, ay, 0, 0),
    load: (gr, lx, ly, s) => (Math.sin(s * hop * TAU) > -0.55 ? 0.9 : 0),
    grains: [{ g, at: tip, from: 0, to: 1 }],
  };
}

// Set on the platter: the hole misses the spindle and the record is pushed
// about until it drops, the spindle's tip dragging across the paper.
function spindled(rand) {
  const oa = rand() * TAU;
  const o = 0.06 + rand() * 0.18;
  const bend = gauss(rand) * 0.8;
  const phi = gauss(rand) * 0.4;
  const g = { size: HAIR * (1.3 + rand() * 0.8), hard: 0.45 + rand() * 0.4, life: 1, seed: rand() * 100, wob: rand() * TAU };
  return {
    steps: steps(o + Math.abs(phi) * 0.2) * 2,
    // The hole wanders in to the spindle along a curve.
    rec: (s) => {
      const e = 1 - s;
      const a = oa + bend * s;
      return pose(phi * s, Math.cos(a) * o * e, Math.sin(a) * o * e);
    },
    load: () => 0.8,
    grains: [{ g, at: [0, 0], from: 0, to: 0.97 }],
    lo: 0.04,
    hi: LABEL - 0.006,
  };
}

// Years of it. The order matters only in that later cuts land on earlier ones.
export function handle(seed, cut, { events = 1 } = {}) {
  const rand = rng(seed);
  const list = [];
  const N = Math.round(250 * events);
  for (let i = 0; i < N; i += 1) {
    const k = rand();
    // On top of the pile it gathers the dust; under others it stays cleaner.
    const dusty = rand() < 0.3 ? 2.2 : 1;
    if (k < 0.3) list.push(pulled(rand, dusty));
    else if (k < 0.42) list.push(covered(rand, dusty));
    else if (k < 0.58) list.push(wiped(rand));
    else list.push(held(rand));
  }
  for (let i = 0; i < 6; i += 1) list.push(spindled(rand));
  for (let i = 0; i < 2; i += 1) list.push(skated(rand));
  for (const ev of list) run(ev, cut);
}

// A fingertip dragged by a hand: a few grains caught under it, each at its
// own place in the pad, picking up more as old ones roll out.
export function fingertip(rand = Math.random) {
  const grains = [];
  const add = () => {
    const a = rand() * TAU;
    const r = 0.022 * Math.sqrt(rand());
    // The first grain under a finger is the one that bites.
    const first = grains.length === 0;
    grains.push({ ox: Math.cos(a) * r * (first ? 0.2 : 1), oy: Math.sin(a) * r * (first ? 0.2 : 1), st: rider(grain(rand, { hard: first ? 1 : 0.2, life: first ? 0.6 + rand() * 0.8 : 0.08 + rand() * 0.4 })) });
  };
  const n = 2 + Math.floor(rand() * 4);
  for (let i = 0; i < n; i += 1) add();
  return { grains, add, rand, s: null };
}

// Carry the fingertip from where it was to where it is, both on the table,
// while the record turned from `a0` to `a1` under it.
export function drag(tip, from, to, a0, a1, load, cut) {
  const d = Math.hypot(to[0] - from[0], to[1] - from[1]) + Math.abs(a1 - a0) * Math.hypot(to[0], to[1]);
  const n = Math.max(1, Math.ceil(d / 0.003));
  for (let i = 1; i <= n; i += 1) {
    const t = i / n;
    const wx = from[0] + (to[0] - from[0]) * t;
    const wy = from[1] + (to[1] - from[1]) * t;
    const a = a0 + (a1 - a0) * t;
    const c = Math.cos(-a);
    const s = Math.sin(-a);
    for (const gr of tip.grains) {
      const x = wx + gr.ox;
      const y = wy + gr.oy;
      ride(gr.st, c * x - s * y, s * x + c * y, load, cut);
    }
  }
  // Grit that has rolled out is replaced, now and then, by grit picked up.
  for (let i = tip.grains.length - 1; i >= 0; i -= 1) if (tip.grains[i].st.done) tip.grains.splice(i, 1);
  if (!tip.grains.length || (tip.grains.length < 6 && tip.rand() < 0.08 * n)) tip.add();
}

export const lift = (tip) => {
  for (const gr of tip.grains) gr.st.tail = null;
};
