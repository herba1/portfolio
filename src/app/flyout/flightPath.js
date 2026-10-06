/* ─────────────────────────────────────────────────────────────────────────
   The path maths.

   Extracted so the flight and the visualiser on /arcs run the SAME code. A
   debug view that reimplements what it is inspecting is worse than no debug
   view — it agrees with you right up until the moment you need it not to.
   Everything /arcs draws comes out of samplePath() below, which is the exact
   function runPath() animates from.
   ───────────────────────────────────────────────────────────────────────── */

import { easeFn } from "./saveMotion";

// B(t) and B'(t) for a cubic through p0, c1, c2, p3.
export const bezAt = (t, a, b, c, d) => {
  const v = 1 - t;
  return v * v * v * a + 3 * v * v * t * b + 3 * v * t * t * c + t * t * t * d;
};
export const bezDeriv = (t, a, b, c, d) => {
  const v = 1 - t;
  return 3 * v * v * (b - a) + 6 * v * t * (c - b) + 3 * t * t * (d - c);
};

export const smoothstep = (u) => {
  const c = Math.min(1, Math.max(0, u));
  return c * c * (3 - 2 * c);
};

/* ── How far the card tips ────────────────────────────────────────────────
   Pointing the card's own "down" exactly along the velocity solves to
   θ = atan2(−vx, vy). That is correct and it is unusable, for two reasons:

     LANDS SIDEWAYS. Exact alignment rotates a horizontally travelling card a
     full 90° — lying on its side. Right for an arrow, absurd for a card. Real
     thrown objects BANK; they do not align.

     FLIPS UPSIDE DOWN. atan2 wraps at ±180°. The moment vertical velocity
     goes negative — the entire point of a lob — the angle leaves ±90°, and as
     vx changes sign it jumps the full 360°. Adjacent keyframes then
     interpolate the long way round and the card spins.

   asin of the normalised horizontal component fixes both. Range is a closed
   [−90°, 90°] with no wrap in it, and it reads as the angle away from
   VERTICAL rather than the absolute heading:

     falling straight down → 0°    rising straight up → 0°  (not inverted)
     moving right → −90°           moving left → +90°
   ───────────────────────────────────────────────────────────────────────── */
export const tipAngle = (vx, vy) => {
  const speed = Math.hypot(vx, vy);
  if (speed < 1e-6) return 0;
  return (Math.asin(Math.max(-1, Math.min(1, -vx / speed))) * 180) / Math.PI;
};

/* Control points as FRACTIONS OF THE TRIP, so one row of numbers is the same
   gesture whether the card travels 80px or 600px. Expressed in deltas from the
   card's own centre: p0 is the origin, which is what makes the clone's first
   frame provably identical to the tile it replaces. */
export function controlPoints(dx, dy, t) {
  return {
    p0: { x: 0, y: 0 },
    c1: { x: dx * t.c1x, y: dy * t.c1y },
    c2: { x: dx * t.c2x, y: dy * t.c2y },
    p3: { x: dx, y: dy },
  };
}

/* Distance along the curve is not the Bézier parameter, and the two are not
   the same — t=0.5 is only halfway along if the control points happen to be
   symmetric. To make even travel mean even travel, the curve is sampled, the
   chord lengths accumulated, and that table inverted. Skipping it is how
   orientation drifts out of phase with position on any asymmetric curve,
   which is all the interesting ones. */
export function arcTable(p0, c1, c2, p3, N = 64) {
  const ts = [0];
  const ls = [0];
  let px = p0.x;
  let py = p0.y;
  let total = 0;
  for (let i = 1; i <= N; i += 1) {
    const t = i / N;
    const x = bezAt(t, p0.x, c1.x, c2.x, p3.x);
    const y = bezAt(t, p0.y, c1.y, c2.y, p3.y);
    total += Math.hypot(x - px, y - py);
    px = x;
    py = y;
    ts.push(t);
    ls.push(total);
  }
  return { ts, ls, total };
}

export function tAtLength(table, frac) {
  const want = frac * table.total;
  const { ts, ls } = table;
  let lo = 0;
  let hi = ls.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (ls[mid] < want) lo = mid;
    else hi = mid;
  }
  const span = ls[hi] - ls[lo];
  const k = span === 0 ? 0 : (want - ls[lo]) / span;
  return ts[lo] + (ts[hi] - ts[lo]) * k;
}

/* ── The one function both the flight and the visualiser call ─────────────
   Position AND rotation out of a single loop, at the same `t`, off the same
   curve — which is the whole reason they cannot drift out of phase. Every
   previous version had two systems agreeing by arrangement.

   Returns one row per sample: where the card is, how fast, which way it is
   pointing, and how fast that is changing. /arcs plots the last two; the
   flight animates the first two.
   ───────────────────────────────────────────────────────────────────────── */
export function samplePath(dx, dy, tuning, N = 40) {
  const { p0, c1, c2, p3 } = controlPoints(dx, dy, tuning);
  const table = arcTable(p0, c1, c2, p3);
  const speed = easeFn(tuning.ease);
  const banking = tuning.rotate !== "none";

  const rows = [];
  for (let i = 0; i <= N; i += 1) {
    const u = i / N;
    const t = tAtLength(table, speed(u));

    const x = bezAt(t, p0.x, c1.x, c2.x, p3.x);
    const y = bezAt(t, p0.y, c1.y, c2.y, p3.y);
    const vx = bezDeriv(t, p0.x, c1.x, c2.x, p3.x);
    const vy = bezDeriv(t, p0.y, c1.y, c2.y, p3.y);

    let deg = 0;
    if (banking) {
      deg = tipAngle(vx, vy) * tuning.rotateAmount;
      deg = Math.max(-tuning.rotateMax, Math.min(tuning.rotateMax, deg));
      // Square at both ends: frame one has to be the tile, arrival has to go
      // in straight. The endpoints are PINNED, not merely faded, so "starts
      // rotated" is not something a rounding error can put back.
      deg *= smoothstep(u / (tuning.rotateIn || 0.0001));
      deg *= smoothstep((1 - u) / (tuning.rotateOut || 0.0001));
      if (i === 0 || i === N) deg = 0;
    }

    rows.push({ u, t, x, y, vx, vy, deg });
  }

  /* Per-sample rates, for the charts. Speed is what tells you where the card
     dawdles; ANGULAR speed is what tells you whether the turn is fighting the
     trip — a spike here with no matching spike in the path is the card
     rotating on its own account, which is the thing that reads as broken. */
  const dt = 1 / N;
  for (let i = 0; i < rows.length; i += 1) {
    const a = rows[Math.max(0, i - 1)];
    const b = rows[Math.min(rows.length - 1, i + 1)];
    const span = (b.u - a.u) || dt;
    rows[i].px = Math.hypot(b.x - a.x, b.y - a.y) / span; // px per unit time
    rows[i].dps = (b.deg - a.deg) / span; // degrees per unit time
  }

  return { rows, p0, c1, c2, p3, length: table.total };
}

/* The scale ramp, as a function of time. The keyframe stops in saveFlight.css
   are 0 / 6 / 16 / 34 / 68 / 100 with a linear timing function, so this is a
   faithful read of what the card is actually doing — which matters, because
   "it lands too big" and "it shrinks too early" are both scale problems that
   look like path problems. */
export function scaleAt(u, t) {
  const stops = [
    [0, 1, 1],
    [0.06, 1 + t.press * 0.6, 1 - t.press],
    [0.16, t.s1, t.s1],
    [0.34, t.s2, t.s2],
    [0.68, t.s3, t.s3],
    [1, t.endScale * t.endSquash, t.endScale],
  ];
  for (let i = 1; i < stops.length; i += 1) {
    if (u <= stops[i][0]) {
      const [ua, xa, ya] = stops[i - 1];
      const [ub, xb, yb] = stops[i];
      const k = ub === ua ? 0 : (u - ua) / (ub - ua);
      return { x: xa + (xb - xa) * k, y: ya + (yb - ya) * k };
    }
  }
  return { x: stops[5][1], y: stops[5][2] };
}
