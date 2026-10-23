// Offline sound modelling, in plain arrays — no Web Audio, so it renders in
// an idle slot, in a worker, or in Node for checking.
//
// Every physical sound is built the same way: a short force (the transient)
// excites resonant modes (the body), and air carries some noise. The contact
// time of the force sets the brightness — a hard, fast contact (a fraction of
// a millisecond) reaches the high modes, a soft one (several milliseconds,
// a fingertip, felt) only the low ones. Each mode is a decaying sinusoid; in
// real materials the high modes die first, so tau falls as frequency rises.
// Variations come from a seeded random: a few percent of detune, contact time
// and level, so a repeated sound never machine-guns.

export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Uniform in [a, b).
export const span = (rand, a, b) => a + (b - a) * rand();
// A multiplier within ±amount of 1.
export const jitter = (rand, amount) => 1 + (rand() * 2 - 1) * amount;

export class Take {
  constructor(sr, seconds) {
    this.sr = sr;
    this.n = Math.max(1, Math.ceil(sr * seconds));
    this.out = new Float32Array(this.n);
  }

  index(at) {
    return Math.round(at * this.sr);
  }

  // A raised-cosine force pulse — the contact. `width` is the contact time in
  // seconds: its spectrum rolls off above roughly 1 / width.
  pulse(at, width, amp = 1) {
    const x = new Float32Array(this.n);
    const i0 = this.index(at);
    const w = Math.max(2, Math.round(width * this.sr));
    for (let i = 0; i < w && i0 + i < this.n; i += 1) x[i0 + i] = amp * (0.5 - 0.5 * Math.cos((2 * Math.PI * (i + 0.5)) / w));
    return x;
  }

  // Band-limited noise with an exponential decay: scrape, air, grit. `lp` and
  // `hp` are one-pole coefficients (0..1, higher lets more through); `curve`
  // is how many time constants fit in `dur`. `attack` ramps it in.
  noise(at, dur, amp, rand, { lp = 0.5, hp = 0.02, curve = 4, attack = 0 } = {}) {
    const x = new Float32Array(this.n);
    const i0 = this.index(at);
    const len = Math.round(dur * this.sr);
    const rise = Math.max(1, Math.round(attack * this.sr));
    let low = 0;
    let slow = 0;
    for (let i = 0; i < len && i0 + i < this.n; i += 1) {
      const env = Math.exp((-curve * i) / Math.max(1, len)) * (attack ? Math.min(1, i / rise) : 1);
      low += (rand() * 2 - 1 - low) * lp;
      slow += (low - slow) * hp;
      x[i0 + i] = (low - slow) * amp * env;
    }
    return x;
  }

  // Sparse random impulses — crackle, paper fibre, grit under a needle.
  // `density` is events per second, shaped by `envelope(t01)`.
  crackle(at, dur, density, amp, rand, envelope = () => 1) {
    const x = new Float32Array(this.n);
    const i0 = this.index(at);
    const len = Math.round(dur * this.sr);
    const p = density / this.sr;
    for (let i = 0; i < len && i0 + i < this.n; i += 1) {
      const e = envelope(i / len);
      if (rand() < p * e) x[i0 + i] += (rand() < 0.5 ? -1 : 1) * amp * e * (0.3 + 0.7 * rand());
    }
    return x;
  }

  // Ring a bank of modes from an excitation. `list` holds [freq, tau, gain]:
  // tau is the 1/e decay in seconds. Gains are normalised across frequency so
  // a mode's level is its gain, wherever it sits.
  modes(x, list, { scale = 1, detune = 1, target = this.out } = {}) {
    const sr = this.sr;
    let first = -1;
    let last = -1;
    for (let i = 0; i < this.n; i += 1) {
      if (x[i] !== 0) {
        if (first < 0) first = i;
        last = i;
      }
    }
    if (first < 0) return target;
    for (const [f0, tau, g] of list) {
      const f = f0 * detune;
      if (f >= sr * 0.45 || f <= 0) continue;
      const r = Math.exp(-1 / (tau * sr));
      const th = (2 * Math.PI * f) / sr;
      const c = 2 * r * Math.cos(th);
      const r2 = r * r;
      // A band-pass resonator (a zero at DC and at Nyquist): a slow push
      // rings the mode without dragging a sub-audible bump along with it,
      // as a plain two-pole would for any contact longer than its period.
      const k = 0.5 * g * scale;
      const end = Math.min(this.n, last + Math.ceil(tau * sr * 9.2));
      let y1 = 0;
      let y2 = 0;
      for (let i = first; i < end; i += 1) {
        const y = c * y1 - r2 * y2 + k * (x[i] - (i >= 2 ? x[i - 2] : 0));
        y2 = y1;
        y1 = y;
        target[i] += y;
      }
    }
    return target;
  }

  // A resonant band-pass whose centre moves over the take: a swept filter on
  // noise is a whoosh, on a buzz a wah. `centre(t01)` returns Hz.
  sweep(x, centre, q = 2, target = this.out, gain = 1) {
    let low = 0;
    let band = 0;
    const damp = 1 / q;
    for (let i = 0; i < this.n; i += 1) {
      // The Chamberlin form stays stable below about a sixth of the rate.
      const f = Math.min(this.sr / 6.5, centre(i / this.n));
      const k = 2 * Math.sin((Math.PI * f) / this.sr);
      low += k * band;
      const high = x[i] - low - damp * band;
      band += k * high;
      target[i] += band * gain;
    }
    return target;
  }

  add(x, gain = 1) {
    for (let i = 0; i < this.n; i += 1) this.out[i] += x[i] * gain;
    return this;
  }

  // Remove DC, normalise to `peak`, and close with a short fade so a take
  // never ends on a step.
  finish(peak = 0.9, fadeSeconds = 0.008) {
    const out = this.out;
    let dc = 0;
    for (let i = 0; i < this.n; i += 1) {
      dc += (out[i] - dc) * 0.0008;
      out[i] -= dc;
    }
    let max = 0;
    for (let i = 0; i < this.n; i += 1) max = Math.max(max, Math.abs(out[i]));
    const k = max > 0 ? peak / max : 0;
    const fade = Math.min(this.n, Math.round(this.sr * fadeSeconds));
    for (let i = 0; i < this.n; i += 1) {
      let v = out[i] * k;
      if (i >= this.n - fade) v *= (this.n - i) / fade;
      out[i] = v;
    }
    return out;
  }
}

// Frequencies of a free bar's bending modes, as ratios of the first: a tine,
// a pawl, a spring arm, a key's lever.
export const BAR = [1, 2.756, 5.404, 8.933];
// A thin plate or a plastic housing: dense, inharmonic.
export const PLATE = [1, 1.59, 2.14, 2.3, 2.65, 2.92, 3.16, 3.5, 3.6, 4.06];
// A struck bell or a glass rim: near pairs beat slowly against each other.
export const BELL = [
  [1, 1, 1],
  [1.0031, 0.8, 0.6],
  [2.32, 0.42, 0.45],
  [2.327, 0.38, 0.3],
  [4.25, 0.22, 0.2],
  [6.63, 0.11, 0.1],
];

// Build a mode list from ratios: tau shrinks and gain falls as the mode
// climbs, which is what makes a body sound like one object.
export function body(f1, ratios, { tau = 0.02, fall = 0.7, gain = 1, tilt = 0.75, rand = null, spread = 0.01 } = {}) {
  return ratios.map((ratio, i) => [
    f1 * ratio * (rand ? jitter(rand, spread) : 1),
    tau * Math.pow(ratio, -fall),
    gain * Math.pow(tilt, i),
  ]);
}
