export const MIN = 30;
export const MAX = 300;
export const START = 120;

const mod = (a, n) => ((a % n) + n) % n;

// An odometer: the ones wheel turns with the value itself; each wheel to its
// left stays put until the one beside it passes 9, then turns with it for
// that last tenth. `shift` is how much of the hundreds wheel shows a blank
// face (0..1), so a two-digit tempo can slide to the centre.
export function wheelPositions(v) {
  const o = mod(v, 10);
  const t = mod(Math.floor(v / 10), 10) + Math.max(0, o - 9);
  const r = mod(v, 100);
  const h = Math.floor(v / 100) + Math.max(0, r - 99);
  return { o, t, h, shift: 1 - Math.min(1, Math.max(0, h)) };
}

// Side bearing of each tabular figure in the numeral face, in em: how far
// the ink sits in from the edge of its slot. Measured from the rendered
// figures (Geist, tabular, weight 460) so the ruler can end exactly under
// the ink of the outer figures rather than under their empty slot edges.
// The tabular 1 carries a slab foot, but still stands well inside its slot.
export const BEARING = [0.038, 0.1, 0.047, 0.04, 0.029, 0.045, 0.047, 0.047, 0.034, 0.045];

// Bearing of a wheel at fractional roll `p`, blended between the outgoing
// and incoming faces. `digits` maps a face index to the figure on it.
export function bearingAt(p, digits) {
  const i = Math.floor(p);
  const f = p - i;
  const at = (k) => BEARING[digits(k)];
  return at(i) + (at(i + 1) - at(i)) * f;
}
