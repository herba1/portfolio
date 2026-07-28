// ---------------------------------------------------------------------------
// Tiny math + spring toolkit for the Covers grid.
// Everything here is allocation-free and safe to call every frame.
// ---------------------------------------------------------------------------

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;

// Always-positive modulo (JS % keeps the sign of the dividend).
export const mod = (n, m) => ((n % m) + m) % m;

export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
}

// Deterministic 0..1 hash from an integer — used for per-tile stagger jitter
// so the lag feels organic instead of perfectly uniform.
export function hash01(n) {
  const s = Math.sin(n * 127.1 + 0.5) * 43758.5453;
  return s - Math.floor(s);
}

// ── easing curves (for the one-time entrance envelope) ─────────────────────
// Smooth, decelerating arrival — no overshoot, no robotic snap.
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
// Gentle accelerate-then-decelerate — the softest "ease in and out" feel.
export const easeInOutCubic = (t) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
// Overshoot ease — the JS twin of cubic-bezier(0.34, 1.56, 0.64, 1). Shoots
// past 1 then settles back to it, so an entrance "pops" with springy life and
// zero physics. `s` controls how far it overshoots (1.70158 ≈ 10%). This is the
// single thing that makes a stagger feel alive instead of robotic.
export const easeOutBack = (t, s = 1.70158) => {
  const u = t - 1;
  return 1 + (s + 1) * u * u * u + s * u * u;
};

// SwiftUI-flavoured spring integrator (semi-implicit Euler).
//   state    : { x, v }  (mutated in place)
//   response : approximate settle time in seconds (smaller = snappier)
//   damping  : fraction, 1 = critically damped, <1 = bouncy, >1 = sluggish
// Returns the new position for convenience.
//
// Semi-implicit Euler is only CONDITIONALLY stable, and the catch is that the
// limit tightens as damping RISES — the opposite of the intuition that a more
// damped spring is a calmer one. For a step h the scheme diverges once
//
//     omega * h  >  2 * ( sqrt(zeta^2 + 1) - zeta )
//
// which is 2.0 undamped but only 0.83 at zeta = 1. (Derived from the update
// matrix, then confirmed by bisecting this integrator numerically — the two
// agree to three decimals across the whole damping range.)
//
// Both follow springs sat ABOVE that ceiling at a plain 60fps:
//
//     follow centre, mobile    omega*dt 1.16   limit 0.88
//     follow centre, desktop   omega*dt 1.05   limit 0.95
//
// A spring past the limit does not wobble, it detonates. It looks fine at rest
// because the error is zero and zero amplifies to zero — the instant you scroll
// and give it something to track, the error compounds every frame and the tiles
// launch. Mobile is further past the line (0.09 response, 0.92 damping from
// responsiveLayout's narrow-viewport values) so it goes first and hardest.
//
// The fix is substepping, not retuning: split the frame into as many steps as
// stability needs at THIS damping. Only the two follow springs ever need more
// than one, so every other spring integrates exactly as before.
const SAFETY = 0.9; // fraction of the true limit we allow
const MAX_SUBSTEPS = 8;

// Largest omega*h this integrator survives at a given damping ratio.
const stableOmegaDt = (zeta) => 2 * (Math.sqrt(zeta * zeta + 1) - zeta);

export function stepSpring(state, target, dt, response, damping) {
  if (response <= 0.0001 || !(dt > 0)) {
    if (response <= 0.0001) {
      state.x = target;
      state.v = 0;
    }
    return state.x;
  }

  // Infinity and NaN are absorbing states: once a spring has taken one, every
  // frame after it is poisoned and the tile never comes back without a reload.
  // Anything that gets in here — a NaN target, a divide-by-zero velocity
  // upstream — is snapped out rather than propagated.
  if (!Number.isFinite(state.x) || !Number.isFinite(state.v)) {
    state.x = Number.isFinite(target) ? target : 0;
    state.v = 0;
    return state.x;
  }
  if (!Number.isFinite(target)) return state.x;

  const omega = (2 * Math.PI) / response;
  const need = Math.ceil((omega * dt) / (SAFETY * stableOmegaDt(damping)));
  // Beyond the substep budget, snapping is the safe failure. Unreachable with
  // this app's config (the worst case needs 3), but a caller passing a near-zero
  // response should get a hard snap, never an explosion.
  if (need > MAX_SUBSTEPS) {
    state.x = target;
    state.v = 0;
    return state.x;
  }

  const n = need < 1 ? 1 : need;
  const h = dt / n;
  const k = omega * omega;
  const c = 2 * damping * omega;
  for (let i = 0; i < n; i++) {
    const a = -k * (state.x - target) - c * state.v;
    state.v += a * h;
    state.x += state.v * h;
  }
  return state.x;
}

export const makeSpring = (x = 0) => ({ x, v: 0 });
