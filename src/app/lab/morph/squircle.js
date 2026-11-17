// Continuous-corner rectangle (the iOS / Figma "corner smoothing" shape).
// A plain border-radius joins a quarter circle straight onto the edge, so
// curvature jumps from zero to 1/r at one point and the corner reads as a
// stamped-on circle. Here each corner starts bending earlier, ramps up
// through a cubic, crosses a shorter arc and ramps back down: curvature is
// continuous all the way round.
//
// The budget (half the short side) caps both the radius and the smoothing.
// When r reaches h/2 the smoothing has no room left and the shape becomes
// an exact capsule, so a pill and a rounded panel are one family and the
// morph between them never kinks.

const rad = (d) => (d * Math.PI) / 180;

function corner(r, smoothing, budget) {
  let p = (1 + smoothing) * r;
  const maxS = budget / r - 1;
  const s = Math.max(0, Math.min(smoothing, maxS));
  p = Math.min(p, budget);
  const arc = 90 * (1 - s);
  const arcLen = Math.sin(rad(arc / 2)) * r * Math.SQRT2;
  const alpha = (90 - arc) / 2;
  const p34 = r * Math.tan(rad(alpha / 2));
  const beta = 45 * s;
  const c = p34 * Math.cos(rad(beta));
  const d = c * Math.tan(rad(beta));
  const b = (p - arcLen - c - d) / 3;
  const a = 2 * b;
  return { a, b, c, d, p, arcLen, r };
}

const f = (n) => Math.round(n * 100) / 100;

export function squircle(w, h, radius, smoothing = 0.6) {
  const budget = Math.min(w, h) / 2;
  const r = Math.max(0.01, Math.min(radius, budget));
  const { a, b, c, d, p, arcLen } = corner(r, smoothing, budget);
  const ab = a + b;
  const abc = a + b + c;
  const bc = b + c;
  return [
    `M${f(w - p)} 0`,
    `c${f(a)} 0 ${f(ab)} 0 ${f(abc)} ${f(d)}`,
    `a${f(r)} ${f(r)} 0 0 1 ${f(arcLen)} ${f(arcLen)}`,
    `c${f(d)} ${f(c)} ${f(d)} ${f(bc)} ${f(d)} ${f(abc)}`,
    `L${f(w)} ${f(h - p)}`,
    `c0 ${f(a)} 0 ${f(ab)} ${f(-d)} ${f(abc)}`,
    `a${f(r)} ${f(r)} 0 0 1 ${f(-arcLen)} ${f(arcLen)}`,
    `c${f(-c)} ${f(d)} ${f(-bc)} ${f(d)} ${f(-abc)} ${f(d)}`,
    `L${f(p)} ${f(h)}`,
    `c${f(-a)} 0 ${f(-ab)} 0 ${f(-abc)} ${f(-d)}`,
    `a${f(r)} ${f(r)} 0 0 1 ${f(-arcLen)} ${f(-arcLen)}`,
    `c${f(-d)} ${f(-c)} ${f(-d)} ${f(-bc)} ${f(-d)} ${f(-abc)}`,
    `L0 ${f(p)}`,
    `c0 ${f(-a)} 0 ${f(-ab)} ${f(d)} ${f(-abc)}`,
    `a${f(r)} ${f(r)} 0 0 1 ${f(arcLen)} ${f(-arcLen)}`,
    `c${f(c)} ${f(-d)} ${f(bc)} ${f(-d)} ${f(abc)} ${f(-d)}`,
    "Z",
  ].join(" ");
}
