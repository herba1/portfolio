// Motion primitives for the splat stage. Everything is in CSS pixels and
// seconds; the stage maps pixels into world space at render time.
//
// One rule runs through all of it: a move never starts from a standstill it
// didn't have. Every flight is a cubic Hermite curve whose starting tangent is
// the actor's current velocity, so grabbing an actor mid-flight (a second
// click, a back link pressed early, a resize) bends the path instead of
// restarting it. Flights always land with zero velocity — no overshoot, no
// bounce — and hand over to exact tracking of the anchor.

export const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (t) => {
  const x = clamp(t);
  return x * x * (3 - 2 * x);
};
export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t), 3);
export const easeInQuad = (t) => clamp(t) * clamp(t);

// Hermite basis at t∈[0,1]: position and derivative (per unit t).
function hermite(p0, m0, p1, m1, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  const p = (2 * t3 - 3 * t2 + 1) * p0 + (t3 - 2 * t2 + t) * m0 + (-2 * t3 + 3 * t2) * p1 + (t3 - t2) * m1;
  const d = (6 * t2 - 6 * t) * p0 + (3 * t2 - 4 * t + 1) * m0 + (-6 * t2 + 6 * t) * p1 + (3 * t2 - 2 * t) * m1;
  return [p, d];
}

const AXES = ["x", "y", "s"];

/**
 * A flight from the actor's current state to a (possibly moving) target.
 * `launch` is the starting tangent in px per flight (velocity × duration),
 * already including any arc. The end tangent is zero: it always lands soft.
 *
 * Entrances pass `control` instead: a quadratic Bézier whose control point
 * sits `control` px from the target, so the path is a visible arc (up and
 * over, then down into the slot). Time runs through it on an ease-out, so it
 * leaves fast, like a throw, and is caught at rest.
 */
export function createFlight({ from, launch, control, duration, kind }) {
  return { from: { ...from }, launch: { ...launch }, control: control && { ...control }, duration, elapsed: 0, kind };
}

const ARC_EASE = 2.6; // u = 1 - (1 - t)^ARC_EASE

/** Advance a flight toward `target`; returns { x, y, s, vx, vy, vs, t, done }. */
export function stepFlight(flight, target, dt) {
  flight.elapsed += dt;
  const t = clamp(flight.elapsed / flight.duration);
  const out = { t, done: t >= 1 };
  if (flight.control) {
    const u = 1 - Math.pow(1 - t, ARC_EASE);
    const du = (ARC_EASE * Math.pow(1 - t, ARC_EASE - 1)) / flight.duration;
    for (const axis of ["x", "y"]) {
      const a = flight.from[axis];
      const c = target[axis] + flight.control[axis];
      const b = target[axis];
      out[axis] = (1 - u) * (1 - u) * a + 2 * u * (1 - u) * c + u * u * b;
      out[`v${axis}`] = (2 * (1 - u) * (c - a) + 2 * u * (b - c)) * du;
    }
    out.s = lerp(flight.from.s, target.s, u);
    out.vs = (target.s - flight.from.s) * du;
    return out;
  }
  for (const axis of AXES) {
    const [p, d] = hermite(flight.from[axis], flight.launch[axis] ?? 0, target[axis], 0, t);
    out[axis] = p;
    out[`v${axis}`] = d / flight.duration;
  }
  return out;
}

/** Unit normal of (dx, dy) that points up the screen — arcs bulge upward. */
export function upwardNormal(dx, dy) {
  const length = Math.hypot(dx, dy) || 1;
  let nx = dy / length;
  let ny = -dx / length;
  if (ny > 0) {
    nx = -nx;
    ny = -ny;
  }
  return [nx, ny];
}

/**
 * Starting tangent for a move between two anchors: the current velocity
 * carried through, plus an upward bulge proportional to the distance. `bend`
 * matches the transitions kit's `arc` prop (0.1–0.3 reads as natural).
 */
export function moveLaunch(state, target, duration, bend) {
  const dx = target.x - state.x;
  const dy = target.y - state.y;
  const [nx, ny] = upwardNormal(dx, dy);
  const lift = Math.hypot(dx, dy) * bend * 4;
  return {
    x: state.vx * duration + nx * lift,
    y: state.vy * duration + ny * lift,
    s: state.vs * duration,
  };
}

/** Flight time for a move: longer for longer trips, capped so nothing races or drags. */
export function moveDuration(state, target) {
  const distance = Math.hypot(target.x - state.x, target.y - state.y);
  return clamp(0.5 + distance / 2200, 0.62, 0.95);
}

/**
 * The first visit's entrance: a lob from low on one side. `side` is -1 (the
 * left edge) or 1 (the right). The actor starts outside the edge, below its
 * slot, climbs past the slot's height and comes down into it from above, so
 * every splat draws one clean arc across the page.
 */
export function tossFrom({ target, side, viewport, duration }) {
  const s = target.s;
  const from = {
    x: side < 0 ? -s * 0.7 : viewport.w + s * 0.7,
    y: target.y + viewport.h * 0.28,
    s: s * 0.5,
  };
  const dx = target.x - from.x;
  // The control point: most of the way across, well above the slot. A
  // quadratic Bézier crests halfway to it, so the apex clears the slot by
  // about a sixth of the viewport.
  const control = {
    x: -dx * 0.32,
    y: -viewport.h * 0.3 - Math.abs(dx) * 0.08,
  };
  return { from, control, duration };
}

/**
 * The entrance for return visits: a shorter arc up from below the fold, curling
 * in from the actor's own side.
 */
export function riseFrom({ target, side, viewport, duration }) {
  const s = target.s;
  const from = { x: target.x + side * viewport.w * 0.16, y: Math.max(target.y + s * 0.8, viewport.h + s * 0.6), s: s * 0.7 };
  const control = { x: side * viewport.w * 0.1, y: -viewport.h * 0.14 };
  return { from, control, duration };
}
