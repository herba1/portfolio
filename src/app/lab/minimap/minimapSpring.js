const TAU = Math.PI * 2;

export function createSpring(value, response, ratio = 1) {
  const spring = { x: value, v: 0, target: value, k: 0, c: 0 };
  tuneSpring(spring, response, ratio);
  return spring;
}

export function tuneSpring(spring, response, ratio = 1) {
  spring.k = (TAU / response) ** 2;
  spring.c = (4 * Math.PI * ratio) / response;
}

export function stepSpring(spring, dt, maxVelocity = Infinity) {
  const steps = Math.max(1, Math.ceil(dt / (1 / 240)));
  const h = dt / steps;
  for (let i = 0; i < steps; i += 1) {
    const a = -spring.k * (spring.x - spring.target) - spring.c * spring.v;
    spring.v += a * h;
    if (spring.v > maxVelocity) spring.v = maxVelocity;
    else if (spring.v < -maxVelocity) spring.v = -maxVelocity;
    spring.x += spring.v * h;
  }
}

export function springAtRest(spring, epsilon) {
  return Math.abs(spring.x - spring.target) < epsilon && Math.abs(spring.v) < epsilon * 12;
}

export function settleSpring(spring) {
  spring.x = spring.target;
  spring.v = 0;
}
