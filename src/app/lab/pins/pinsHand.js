const FINGERS = [
  [-0.142, 0.05, -0.19, 0.36, 0.05],
  [-0.048, 0.07, -0.062, 0.43, 0.054],
  [0.046, 0.06, 0.07, 0.385, 0.051],
  [0.132, 0.02, 0.19, 0.275, 0.044],
  [-0.19, -0.16, -0.365, 0.03, 0.062],
];

export const HAND_EXTENT = { left: -0.44, right: 0.27, bottom: -0.4, top: 0.5 };

function capsule(px, py, ax, ay, bx, by, r) {
  const pax = px - ax;
  const pay = py - ay;
  const bax = bx - ax;
  const bay = by - ay;
  const t = Math.min(1, Math.max(0, (pax * bax + pay * bay) / (bax * bax + bay * bay)));
  return Math.hypot(pax - bax * t, pay - bay * t) - r;
}

function roundBox(px, py, cx, cy, hx, hy, r) {
  const dx = Math.abs(px - cx) - hx + r;
  const dy = Math.abs(py - cy) - hy + r;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) + Math.min(Math.max(dx, dy), 0) - r;
}

function smoothMin(a, b, k) {
  const h = Math.min(1, Math.max(0, 0.5 + (0.5 * (b - a)) / k));
  return b + (a - b) * h - k * h * (1 - h);
}

export function handDistance(x, y) {
  let d = roundBox(x, y, -0.005, -0.13, 0.19, 0.21, 0.11);
  for (const f of FINGERS) d = smoothMin(d, capsule(x, y, f[0], f[1], f[2], f[3], f[4]), 0.035);
  return d;
}

export function handPressure(x, y) {
  if (x < HAND_EXTENT.left || x > HAND_EXTENT.right || y < HAND_EXTENT.bottom || y > HAND_EXTENT.top) return 0;
  const d = handDistance(x, y);
  if (d > 0.03) return 0;
  const t = Math.min(1, Math.max(0, (0.03 - d) / 0.1));
  const shoulder = t * t * (3 - 2 * t);
  const palm = Math.exp(-((x + 0.01) * (x + 0.01) + (y + 0.12) * (y + 0.12)) / 0.05);
  return Math.sqrt(shoulder) * (0.86 + 0.14 * palm);
}
