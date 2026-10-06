const EPS = 0.001;
const MAX_MS = 5000;
const SETTLE_POSITION = 0.0015;
const SETTLE_VELOCITY = 0.02;
const MINIMUM_HOLD_MS = 450;
const FULL_HOLD_MS = 900;

export const STAGE = {
  charDamping: 1,
  charSpread: 0.6,
  charMinMs: 200,
  charMaxMs: 460,
  riseEm: 0.14,
  revealTilt: 14,
  revealDepth: 12,
  revealSpin: 0,
  revealPop: 0,
  lineDepth: 32,
  shimmer: 0.6,
  shimmerAttackMs: 80,
  shimmerBrightness: 2,
  shimmerScale: 0.12,
  holdSettleMs: 260,
  shimmerSweepMs: 1100,
  shimmerWidth: 0.5,
  holdLift: 0.01,
  focusWidth: 0.85,
  restOpacity: 0.26,
  restScale: 0.3,
  blur: 1.2,
  lineGap: 0.64,
  tracking: -0.04,
  stiffness: 120,
};

export const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

export const falloff = (distance, width) => Math.exp(-(distance * distance) / (width * width));

export function makeSpec(stiffness, ratio, mass = 1) {
  return { mass, stiffness, damping: ratio * 2 * Math.sqrt(stiffness * mass) };
}

function dampingRatio(spec) {
  return spec.damping / (2 * Math.sqrt(spec.stiffness * spec.mass));
}

function springResponse(spec, t) {
  const w = Math.sqrt(spec.stiffness / spec.mass);
  const z = dampingRatio(spec);
  if (z < 1) {
    const wd = w * Math.sqrt(1 - z * z);
    return Math.exp(-z * w * t) * (Math.cos(wd * t) + ((z * w) / wd) * Math.sin(wd * t));
  }
  if (z === 1) return (1 + w * t) * Math.exp(-w * t);
  const s = w * Math.sqrt(z * z - 1);
  const r1 = -z * w + s;
  const r2 = -z * w - s;
  return (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
}

function springStateAt(spec, x0, v0, t) {
  const w = Math.sqrt(spec.stiffness / spec.mass);
  const z = dampingRatio(spec);
  if (z < 1) {
    const a = z * w;
    const wd = w * Math.sqrt(1 - z * z);
    const c = (v0 + a * x0) / wd;
    const e = Math.exp(-a * t);
    const cs = Math.cos(wd * t);
    const sn = Math.sin(wd * t);
    return { x: e * (x0 * cs + c * sn), v: e * ((c * wd - a * x0) * cs - (a * c + x0 * wd) * sn) };
  }
  if (z === 1) {
    const c = v0 + w * x0;
    const e = Math.exp(-w * t);
    return { x: (x0 + c * t) * e, v: (v0 - w * c * t) * e };
  }
  const s = w * Math.sqrt(z * z - 1);
  const r1 = -z * w + s;
  const r2 = -z * w - s;
  const c1 = (v0 - r2 * x0) / (r1 - r2);
  const c2 = x0 - c1;
  return {
    x: c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t),
    v: c1 * r1 * Math.exp(r1 * t) + c2 * r2 * Math.exp(r2 * t),
  };
}

function springDuration(spec) {
  const w = Math.sqrt(spec.stiffness / spec.mass);
  const z = dampingRatio(spec);
  let bound = MAX_MS;
  if (z < 1) {
    const a = z * w;
    const wd = w * Math.sqrt(1 - z * z);
    const amp = Math.sqrt(1 + (a / wd) ** 2);
    bound = Math.min(Math.ceil((Math.log(amp / EPS) / a) * 1000), MAX_MS);
  }
  for (let ms = bound; ms >= 0; ms -= 1) {
    if (Math.abs(springResponse(spec, ms / 1000)) >= EPS) return Math.min(ms + 1, MAX_MS);
  }
  return MAX_MS;
}

export class SpringValue {
  constructor(spec, initial = 0) {
    this.spec = spec;
    this.target = initial;
    this.offset = 0;
    this.velocity = 0;
    this.elapsed = 0;
    this.settled = true;
  }

  get value() {
    if (this.settled) return this.target;
    return this.target + springStateAt(this.spec, this.offset, this.velocity, this.elapsed).x;
  }

  get currentVelocity() {
    if (this.settled) return 0;
    return springStateAt(this.spec, this.offset, this.velocity, this.elapsed).v;
  }

  retarget(next) {
    if (next === this.target) return;
    const position = this.value;
    const velocity = this.currentVelocity;
    this.target = next;
    this.offset = position - next;
    this.velocity = velocity;
    this.elapsed = 0;
    this.settled = false;
  }

  jump(next) {
    this.target = next;
    this.offset = 0;
    this.velocity = 0;
    this.elapsed = 0;
    this.settled = true;
  }

  advance(deltaSeconds) {
    if (this.settled) return this.target;
    this.elapsed += deltaSeconds;
    const solved = springStateAt(this.spec, this.offset, this.velocity, this.elapsed);
    if (Math.abs(solved.x) < SETTLE_POSITION && Math.abs(solved.v) < SETTLE_VELOCITY) {
      this.settled = true;
      this.offset = 0;
      this.velocity = 0;
      this.elapsed = 0;
      return this.target;
    }
    return this.target + solved.x;
  }
}

const revealSprings = new Map();

function springProgress(progress, damping = 1) {
  if (progress <= 0) return 0;
  if (progress >= 1) return 1;
  if (!revealSprings.has(damping)) {
    const spec = makeSpec(200, damping);
    revealSprings.set(damping, { spec, duration: springDuration(spec) / 1000 });
  }
  const { spec, duration } = revealSprings.get(damping);
  return 1 - springResponse(spec, progress * duration);
}

export function characterReveal(elapsed, duration, index, count, config = STAGE) {
  const stagger = count > 1 ? (duration * config.charSpread) / count : 0;
  const maximum = Math.max(config.charMinMs, config.charMaxMs);
  const revealMs = Math.min(maximum, Math.max(config.charMinMs, stagger * 2.6));
  return springProgress((elapsed - index * stagger) / revealMs, config.charDamping);
}

function smoothStep(value) {
  const t = clamp(value, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

export function holdShimmer(elapsed, duration, index, count, config = STAGE) {
  if (elapsed <= 0 || elapsed >= duration || duration <= MINIMUM_HOLD_MS) return 0;
  const strength = smoothStep((duration - MINIMUM_HOLD_MS) / (FULL_HOLD_MS - MINIMUM_HOLD_MS));
  const progress = clamp(elapsed / Math.max(duration, config.shimmerSweepMs, 600), 0, 1);
  const attack = smoothStep(elapsed / Math.max(40, config.shimmerAttackMs));
  const release = smoothStep((duration - elapsed) / Math.min(360, duration * 0.4));
  const width = Math.max(0.2, config.shimmerWidth);
  const position = count > 1 ? index / (count - 1) : 0;
  const distance = (position - progress) / width;
  return Math.exp(-distance * distance) * strength * attack * release;
}

export function holdEmphasis(elapsed, duration, index, count, config = STAGE) {
  if (elapsed <= 0 || elapsed >= duration || duration <= MINIMUM_HOLD_MS) return 0;
  const strength = smoothStep((duration - MINIMUM_HOLD_MS) / (FULL_HOLD_MS - MINIMUM_HOLD_MS));
  const phase = count > 1 ? index / (count - 1) : 0;
  const delay = Math.min(90, duration * 0.12) * phase;
  const settleMs = Math.max(100, config.holdSettleMs);
  const attack = springProgress((elapsed - delay) / settleMs);
  const releaseMs = Math.min(settleMs * 1.4, duration * 0.4);
  const release = 1 - springProgress((elapsed - (duration - releaseMs)) / releaseMs);
  return strength * attack * release;
}
