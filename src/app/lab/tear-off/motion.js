export function cubicBezier(x1, y1, x2, y2) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const sampleX = (t) => ((ax * t + bx) * t + cx) * t;
  const sampleY = (t) => ((ay * t + by) * t + cy) * t;
  const slopeX = (t) => (3 * ax * t + 2 * bx) * t + cx;
  return (x) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let t = x;
    for (let i = 0; i < 8; i += 1) {
      const error = sampleX(t) - x;
      if (Math.abs(error) < 1e-6) return sampleY(t);
      const slope = slopeX(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= error / slope;
    }
    let low = 0;
    let high = 1;
    t = x;
    for (let i = 0; i < 24; i += 1) {
      const value = sampleX(t);
      if (Math.abs(value - x) < 1e-6) break;
      if (value < x) low = t;
      else high = t;
      t = (low + high) / 2;
    }
    return sampleY(t);
  };
}

export const easeEntrance = cubicBezier(0.16, 1, 0.3, 1);
export const easeInOut = cubicBezier(0.7, 0, 0.3, 1);
export const easeInQuad = cubicBezier(0.55, 0.085, 0.68, 0.53);
export const easeOutQuint = cubicBezier(0.22, 1, 0.36, 1);

export function springProgress(durationMs, bounce) {
  const zeta = 1 - bounce;
  const omega = (2 * Math.PI) / (durationMs / 1000);
  const damped = omega * Math.sqrt(Math.max(1e-6, 1 - zeta * zeta));
  const settle = 6.9 / (zeta * omega);
  return {
    settle: settle * 1000,
    at(ms) {
      const t = ms / 1000;
      if (t >= settle) return 1;
      const envelope = Math.exp(-zeta * omega * t);
      return 1 - envelope * (Math.cos(damped * t) + ((zeta * omega) / damped) * Math.sin(damped * t));
    },
  };
}
