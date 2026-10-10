export const WAVE_SPEED = 520;
export const WAVE_DAMPING = 4.4;
export const SETTLE_WAVE_DAMPING = 5.5;
export const CALM_WAVE_DAMPING = 34;

const MAX_SUBSTEP = 1 / 240;
const MAX_SUBSTEPS = 48;
const COURANT = 0.7;
const MAX_PINS = 4;

export function createString(nodeCount) {
  const count = Math.max(9, nodeCount);
  return {
    count,
    u: new Float64Array(count),
    v: new Float64Array(count),
    top: 0,
    bottom: 1,
    pinY: new Float64Array(MAX_PINS),
    pinTarget: new Float64Array(MAX_PINS),
    pinCount: 0,
    peakSpeed: 0,
  };
}

export function nodeSpacing(string) {
  return Math.max(1, (string.bottom - string.top) / (string.count - 1));
}

export function nodeY(string, index) {
  return string.top + index * nodeSpacing(string);
}

export function clearPins(string) {
  string.pinCount = 0;
}

export function addPin(string, y, target) {
  if (string.pinCount >= MAX_PINS) return;
  string.pinY[string.pinCount] = y;
  string.pinTarget[string.pinCount] = target;
  string.pinCount += 1;
}

function applyPins(string, spacing) {
  const { u, v, count, top } = string;
  for (let pin = 0; pin < string.pinCount; pin += 1) {
    const position = (string.pinY[pin] - top) / spacing;
    const lower = Math.floor(position);
    for (let index = lower; index <= lower + 1; index += 1) {
      if (index < 1 || index > count - 2) continue;
      const weight = 1 - Math.abs(position - index);
      if (weight <= 0) continue;
      u[index] += (string.pinTarget[pin] - u[index]) * weight;
      v[index] *= 1 - weight;
    }
  }
}

export function stepString(string, dt, damping) {
  const { u, v, count } = string;
  const spacing = nodeSpacing(string);
  const stableStep = Math.min(MAX_SUBSTEP, (COURANT * spacing) / WAVE_SPEED);
  const steps = Math.min(MAX_SUBSTEPS, Math.max(1, Math.ceil(dt / stableStep)));
  const step = dt / steps;
  const stiffness = (WAVE_SPEED * WAVE_SPEED) / (spacing * spacing);
  const last = count - 1;
  for (let pass = 0; pass < steps; pass += 1) {
    for (let index = 1; index < last; index += 1) {
      const curvature = u[index - 1] - 2 * u[index] + u[index + 1];
      v[index] += (stiffness * curvature - damping * v[index]) * step;
    }
    for (let index = 1; index < last; index += 1) u[index] += v[index] * step;
    applyPins(string, spacing);
  }
  u[0] = 0;
  v[0] = 0;
  u[last] = 0;
  v[last] = 0;
  let peak = 0;
  let peakSpeed = 0;
  for (let index = 1; index < last; index += 1) {
    const reach = Math.abs(u[index]);
    const speed = Math.abs(v[index]);
    if (reach > peak) peak = reach;
    if (speed > peakSpeed) peakSpeed = speed;
  }
  string.peakSpeed = peakSpeed;
  return peak;
}

export function sampleString(string, y) {
  const spacing = nodeSpacing(string);
  const position = Math.min(string.count - 1, Math.max(0, (y - string.top) / spacing));
  const lower = Math.min(string.count - 2, Math.floor(position));
  const fraction = position - lower;
  return string.u[lower] + (string.u[lower + 1] - string.u[lower]) * fraction;
}

export function addBump(string, y, amplitude, halfWidth) {
  const { u, count } = string;
  for (let index = 1; index < count - 1; index += 1) {
    const distance = Math.abs(nodeY(string, index) - y) / halfWidth;
    if (distance >= 1) continue;
    u[index] += amplitude * (0.5 + 0.5 * Math.cos(Math.PI * distance));
  }
}

export function addPulse(string, y, amplitude, width) {
  const { u, v, count } = string;
  for (let index = 1; index < count - 1; index += 1) {
    const offset = nodeY(string, index) - y;
    const shape = amplitude * Math.exp(-(offset * offset) / (width * width));
    u[index] += shape;
    v[index] += ((WAVE_SPEED * 2 * offset) / (width * width)) * shape;
  }
}

export function clearString(string) {
  string.u.fill(0);
  string.v.fill(0);
}
