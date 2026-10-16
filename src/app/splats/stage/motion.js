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
 */
export function createFlight({ from, launch, duration, kind }) {
  return { from: { ...from }, launch: { ...launch }, duration, elapsed: 0, kind };
}

/** Advance a flight toward `target`; returns { x, y, s, vx, vy, vs, t, done }. */
export function stepFlight(flight, target, dt) {
  flight.elapsed += dt;
  const t = clamp(flight.elapsed / flight.duration);
  const out = { t, done: t >= 1 };
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
  return clamp(0.42 + distance / 2600, 0.52, 0.86);
}

/**
 * Where an entering actor starts and how it is thrown. `side` is -1 (from the
 * left edge) or 1 (from the right). The actor starts above and outside its
 * slot and is launched inward and slightly up, so the Hermite curve rises,
 * turns over and falls into place: a toss, not a slide.
 */
export function tossFrom({ target, side, viewport, duration }) {
  const s = target.s;
  const from = {
    x: side < 0 ? -s * 0.9 : viewport.w + s * 0.9,
    y: target.y - viewport.h * 0.22 - s * 0.2,
    s: s * 0.82,
  };
  const dx = target.x - from.x;
  const launch = {
    x: dx * 1.35,
    y: -Math.abs(dx) * 0.55,
    s: 0,
  };
  return { from, launch, duration };
}

/** A gentler entrance for returning visits: rise from below the fold. */
export function riseFrom({ target, viewport, duration }) {
  const from = { x: target.x, y: Math.max(target.y + target.s * 0.6, viewport.h + target.s * 0.6), s: target.s * 0.9 };
  return { from, launch: { x: 0, y: (target.y - from.y) * 1.4, s: 0 }, duration };
}
