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

// The lead (hundreds) wheel sets proportional figures pushed to the right
// edge of their slot, so each face is described from that edge instead:
// `box` is how much of the slot it fills and `ink` how far in from the
// right edge its ink begins, both in em. Measured from the rendered figures
// (Geist, proportional, weight 460: advance and left side bearing, read off
// the pixels, since canvas text metrics ignore the weight axis and report
// the default instance's outlines). The 1 is pulled 0.06em
// towards the tens figure by tempo.css, which shortens both.
const KERN_1 = 0.06;
export const LEAD = {
  1: { box: 0.397 - KERN_1, ink: 0.397 - 0.04 - KERN_1 },
  2: { box: 0.626, ink: 0.626 - 0.06 },
  3: { box: 0.62, ink: 0.62 - 0.049 },
};

// The lead wheel's faces in order: blank, 1, 2, 3, blank.
const LEAD_FACES = [0, 1, 2, 3, 0];

// What the lead wheel adds to the numeral at roll `h`, in px, for a slot
// `slot` px wide followed by `track` px of tracking: the spare width the
// number slides over to stay centred, and where the lead figure's ink
// starts. A blank face gives up the whole slot and its tracking.
export function leadAt(h, em, slot, track) {
  const i = Math.floor(h);
  const f = h - i;
  const at = (k) => {
    const d = LEAD_FACES[Math.min(4, Math.max(0, k))];
    const m = LEAD[d || (k <= 0 ? 1 : 3)];
    return { spare: d ? slot - m.box * em : slot + track, ink: slot - m.ink * em };
  };
  const a = at(i);
  const b = at(i + 1);
  return { spare: a.spare + (b.spare - a.spare) * f, ink: a.ink + (b.ink - a.ink) * f };
}
