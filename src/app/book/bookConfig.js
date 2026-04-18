// Per-bone weight functions — each mode is a different "shape" of the fold.
// u ∈ [0, 1] goes from hinge (u=0) to free edge (u=1).
export const ARC_MODES = {
  uniform: (u) => 1, // even distribution — circular arc, peak at free edge
  inverted: (u) => 2 * (1 - u), // peak near hinge, free edge stays low
  tent: (u) => Math.sin(u * Math.PI), // peak in the middle
  whip: (u) => 2 * u, // front-edge heavy — late snap
  concertina: (u) => Math.abs(Math.sin(u * 2 * Math.PI)), // double-peak ripple
  easeOut: (u) => 1 - Math.pow(1 - u, 2), // soft start, firmer free-edge rise
  easeIn: (u) => Math.pow(u, 2), // flat near hinge, strong curl at end
};

export const ARC_MODE_NAMES = Object.keys(ARC_MODES);

export const DEFAULT_CONFIG = {
  arcBlend: 0.5,
  arcMode: "uniform",
  foldAmplitude: 0.03,
  axisTiltAmplitude: 0.0,
  releaseDurationMs: 600,
  releaseEase: "material",
  flickInfluence: 0.7,
  flickLookaheadSec: 0.14,
  dragDistanceRatio: 0.4,
  commitThreshold: 0.45,
  randomness: 0.18,
  showPanel: true,
};

export function seededRand(seed, salt = 0) {
  const x = Math.sin(seed * 9301 + salt * 49297) * 233280;
  return (x - Math.floor(x)) * 2 - 1;
}

// Proper cubic-bezier evaluator (matches CSS cubic-bezier() semantics).
// Reference: tempo-ease / CSS spec Newton-Raphson + binary subdivision.
function makeBezier(p1x, p1y, p2x, p2y) {
  const A = (a, b) => 1 - 3 * b + 3 * a;
  const B = (a, b) => 3 * b - 6 * a;
  const C = (a) => 3 * a;
  const calc = (t, a, b) => ((A(a, b) * t + B(a, b)) * t + C(a)) * t;
  const slope = (t, a, b) => 3 * A(a, b) * t * t + 2 * B(a, b) * t + C(a);
  function tForX(x) {
    let g = x;
    for (let i = 0; i < 5; i++) {
      const s = slope(g, p1x, p2x);
      if (s === 0) return g;
      const cx = calc(g, p1x, p2x) - x;
      g -= cx / s;
    }
    return g;
  }
  return (x) => {
    if (p1x === p1y && p2x === p2y) return x;
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return calc(tForX(x), p1y, p2y);
  };
}

// Paper-appropriate curves. Defaults follow the cookbook palette.
export const EASE_OUT = {
  smooth:   makeBezier(0.19, 1, 0.22, 1),           // expo-out — long decay, no overshoot
  material: makeBezier(0.4, 0, 0.2, 1),             // Material standard — balanced
  ios:      makeBezier(0.25, 0.1, 0.25, 1),         // iOS default — gentle
  outExpo:  makeBezier(0.16, 1, 0.3, 1),            // alt expo-out
  outQuint: makeBezier(0.22, 1, 0.36, 1),           // firmer decel
  snappy:   makeBezier(0.175, 0.885, 0.32, 1.1),    // tiny overshoot
  outQuart: makeBezier(0.165, 0.84, 0.44, 1),       // polynomial equivalent
};
export const EASE_OUT_NAMES = Object.keys(EASE_OUT);
