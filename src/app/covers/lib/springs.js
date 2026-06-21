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
export function stepSpring(state, target, dt, response, damping) {
  if (response <= 0.0001) {
    state.x = target;
    state.v = 0;
    return state.x;
  }
  const omega = (2 * Math.PI) / response;
  const k = omega * omega;
  const c = 2 * damping * omega;
  const a = -k * (state.x - target) - c * state.v;
  state.v += a * dt;
  state.x += state.v * dt;
  return state.x;
}

export const makeSpring = (x = 0) => ({ x, v: 0 });
