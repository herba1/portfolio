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
