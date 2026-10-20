const STEP = 1 / 240;

export function createSpring(value, { response = 0.42, damping = 0.9 } = {}) {
  return {
    x: value,
    v: 0,
    target: value,
    k: (2 * Math.PI / response) ** 2,
    c: (4 * Math.PI * damping) / response,
  };
}

export function stepSpring(s, dt) {
  let left = Math.min(dt, 1 / 20);
  while (left > 0) {
    const h = Math.min(left, STEP);
    const a = -s.k * (s.x - s.target) - s.c * s.v;
    s.v += a * h;
    s.x += s.v * h;
    left -= h;
  }
  if (Math.abs(s.x - s.target) < 0.02 && Math.abs(s.v) < 0.5) {
    s.x = s.target;
    s.v = 0;
    return true;
  }
  return false;
}

export function snapSpring(s, value) {
  s.x = value;
  s.target = value;
  s.v = 0;
}
