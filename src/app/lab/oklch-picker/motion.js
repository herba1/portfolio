export function spring(value, response = 0.3, damping = 1) {
  return { x: value, v: 0, target: value, k: (2 * Math.PI / response) ** 2, c: (4 * Math.PI * damping) / response };
}

export function tune(s, response, damping = 1) {
  s.k = (2 * Math.PI / response) ** 2;
  s.c = (4 * Math.PI * damping) / response;
}

export function settle(s, value) {
  s.x = value;
  s.target = value;
  s.v = 0;
}

export function step(s, dt, eps) {
  let left = Math.min(dt, 0.064);
  while (left > 0) {
    const h = Math.min(left, 1 / 240);
    const a = -s.k * (s.x - s.target) - s.c * s.v;
    s.v += a * h;
    s.x += s.v * h;
    left -= h;
  }
  if (Math.abs(s.x - s.target) < eps && Math.abs(s.v) < eps * 10) {
    s.x = s.target;
    s.v = 0;
    return false;
  }
  return true;
}

export function createLoop(tick) {
  let raf = 0;
  let last = 0;
  const frame = (t) => {
    const dt = last ? Math.min((t - last) / 1000, 0.05) : 1 / 60;
    last = t;
    const more = tick(dt);
    if (more) raf = requestAnimationFrame(frame);
    else {
      raf = 0;
      last = 0;
    }
  };
  return {
    kick() {
      if (!raf) raf = requestAnimationFrame(frame);
    },
    stop() {
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
    },
  };
}

export function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
