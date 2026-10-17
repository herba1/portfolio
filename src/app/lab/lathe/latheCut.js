export const TAU = Math.PI * 2;
export const W = 1024;
export const ROWS = 64;
export const R_TOP = 174;
export const PITCH = 1.8;
export const R_INNER = 66;
export const U_MAX = (R_TOP - R_INNER) / PITCH;
export const OMEGA = (TAU * 100) / 180;
export const TURN_SECONDS = TAU / OMEGA;
export const A1 = 0.24 * PITCH;
export const A2 = 0.15 * PITCH;
export const ARM_P = [-205, -190];
export const ARM_L = 262;
export const MIC_L = [176, -132];
export const LENS_MAG = 7;
export const PHASE_WRAP = 64;

const ARM_D = Math.hypot(ARM_P[0], ARM_P[1]);
const ARM_PHI = Math.atan2(ARM_P[1], ARM_P[0]);

export function betaForRadius(r) {
  const k = (r * r - ARM_D * ARM_D - ARM_L * ARM_L) / (2 * ARM_L * ARM_D);
  return ARM_PHI + Math.acos(Math.min(1, Math.max(-1, k)));
}

export function stylusAt(beta) {
  return [ARM_P[0] + ARM_L * Math.cos(beta), ARM_P[1] + ARM_L * Math.sin(beta)];
}

export const BETA_REST = betaForRadius(203);

export function radiusAt(u) {
  return R_TOP - PITCH * u;
}

export function phaseStep(w) {
  return 0.22 * Math.pow(2, 1.25 * w);
}

export function createGroove() {
  return { data: new Float32Array(W * ROWS * 4), phase: 0, first: -1, last: -1, samples: 0, lo: ROWS, hi: -1 };
}

export function clearGroove(groove) {
  groove.data.fill(0);
  groove.phase = 0;
  groove.first = -1;
  groove.last = -1;
  groove.samples = 0;
  groove.lo = 0;
  groove.hi = ROWS - 1;
}

export function writeSpan(groove, u0, u1, a, b) {
  const s0 = Math.floor(u0 * W) + 1;
  const s1 = Math.min(Math.floor(u1 * W), W * ROWS - 1);
  if (s1 < s0) return;
  const span = Math.max(1e-9, u1 - u0);
  const { data } = groove;
  for (let s = Math.max(0, s0); s <= s1; s++) {
    const f = Math.min(1, Math.max(0, (s / W - u0) / span));
    const w = a.w + (b.w - a.w) * f;
    const g = a.g + (b.g - a.g) * f;
    const depth = a.depth + (b.depth - a.depth) * f;
    groove.phase = (groove.phase + phaseStep(w)) % PHASE_WRAP;
    const i = s * 4;
    data[i] = w;
    data[i + 1] = g;
    data[i + 2] = groove.phase;
    data[i + 3] = depth;
    if (depth > 0.5) {
      if (groove.first < 0) groove.first = s / W;
      groove.last = s / W;
      groove.samples += 1;
    }
  }
  const r0 = Math.floor(Math.max(0, s0) / W);
  const r1 = Math.floor(s1 / W);
  groove.lo = Math.min(groove.lo, r0);
  groove.hi = Math.max(groove.hi, r1);
}

export function sampleAt(groove, u) {
  const s = u * W;
  const i0 = Math.floor(s);
  if (i0 < 0 || i0 >= W * ROWS - 1) return { w: 0, g: 0, depth: 0, phase: 0 };
  const f = s - i0;
  const { data } = groove;
  const a = i0 * 4;
  const b = a + 4;
  let dp = data[b + 2] - data[a + 2];
  if (dp < 0) dp += PHASE_WRAP;
  return {
    w: data[a] + (data[b] - data[a]) * f,
    g: data[a + 1] + (data[b + 1] - data[a + 1]) * f,
    depth: data[a + 3] + (data[b + 3] - data[a + 3]) * f,
    phase: data[a + 2] + dp * f,
  };
}

export function offsetAt(sample, smear = 0) {
  return sample.w * A1 + A2 * sample.g * (1 - smear) * Math.sin(TAU * sample.phase);
}

const PHRASE = [0, 3, 7, 10, 12, 10, 7, 7, 5, 3, 5, 7, 3, 0, -2, 0, 3, 7, 12, 15, 12, 10, 12, 10, 7, 5, 7, 3, 5, 3, 0, -2, -5, -2, 0, 0, 0];

export function presetTake(groove) {
  clearGroove(groove);
  const start = 0.3;
  const end = 9.35;
  const per = 0.25;
  let w = 0;
  let g = 0;
  let note = -1;
  const step = 1 / W;
  let prev = { w: 0, g: 0, depth: 0 };
  for (let u = start; u < end; u += step) {
    const k = Math.min(PHRASE.length - 1, Math.floor((u - start) / per));
    const target = PHRASE[k] / 15;
    if (k !== note) {
      note = k;
      g = Math.max(g, 0.85);
    }
    w += (target - w) * 0.045;
    g += (0.22 - g) * 0.006;
    const vib = 0.01 * Math.sin(TAU * u * 9.3) * Math.min(1, (u - start) / 0.5);
    const depth = Math.min(1, (u - start) / 0.06, (end - u) / 0.06);
    const next = { w: w + vib, g, depth: Math.max(0, depth) };
    writeSpan(groove, u - step, u, prev, next);
    prev = next;
  }
  return 10;
}
