function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BODY = [
  [112, 0.064, 0.15],
  [178, 0.052, 0.186],
  [251, 0.044, 0.165],
  [337, 0.034, 0.15],
  [446, 0.028, 0.126],
  [571, 0.0232, 0.108],
  [693, 0.02, 0.09],
  [827, 0.0168, 0.078],
  [968, 0.0144, 0.066],
  [1141, 0.012, 0.054],
  [1362, 0.0104, 0.045],
  [1617, 0.0088, 0.036],
  [1983, 0.0072, 0.027],
  [2437, 0.006, 0.021],
  [2991, 0.0048, 0.015],
  [3647, 0.004, 0.011],
];

const PLATEN = [
  [205, 0.011, 0.9],
  [468, 0.008, 0.62],
  [757, 0.006, 0.4],
  [1096, 0.005, 0.26],
];

const BEAM = [1, 2.756, 5.404, 8.933];

const BELL = [
  [1, 0.9, 0.5],
  [1.0031, 0.8, 0.32],
  [2.32, 0.42, 0.28],
  [2.327, 0.38, 0.16],
  [4.25, 0.22, 0.12],
  [6.63, 0.11, 0.06],
];

class Voice {
  constructor(sr, seconds) {
    this.sr = sr;
    this.n = Math.ceil(sr * seconds);
    this.out = new Float32Array(this.n);
    this.body = new Float32Array(this.n);
  }

  pulse(at, width, amp, into = null) {
    const x = new Float32Array(this.n);
    const i0 = Math.round(at * this.sr);
    const w = Math.max(2, Math.round(width * this.sr));
    for (let i = 0; i < w && i0 + i < this.n; i += 1) {
      const v = amp * Math.sin((Math.PI * (i + 0.5)) / w);
      x[i0 + i] += v;
      if (into) into[i0 + i] += v;
    }
    return x;
  }

  noise(at, dur, amp, rand, lp = 0.5, hp = 0.02, into = null) {
    const x = new Float32Array(this.n);
    const i0 = Math.round(at * this.sr);
    const len = Math.round(dur * this.sr);
    let low = 0;
    let slow = 0;
    for (let i = 0; i < len && i0 + i < this.n; i += 1) {
      const env = Math.exp((-4 * i) / Math.max(1, len));
      low += (rand() * 2 - 1 - low) * lp;
      slow += (low - slow) * hp;
      const v = (low - slow) * amp * env;
      x[i0 + i] += v;
      if (into) into[i0 + i] += v;
    }
    return x;
  }

  modes(x, list, scale = 1, target = this.out, detune = 1) {
    const sr = this.sr;
    let first = -1;
    let last = -1;
    for (let i = 0; i < this.n; i += 1) {
      if (x[i] !== 0) {
        if (first < 0) first = i;
        last = i;
      }
    }
    if (first < 0) return;
    for (const [f0, tau, g] of list) {
      const f = f0 * detune;
      if (f >= sr * 0.45) continue;
      const r = Math.exp(-1 / (tau * sr));
      const th = (2 * Math.PI * f) / sr;
      const c = 2 * r * Math.cos(th);
      const r2 = r * r;
      const k = g * scale * Math.sin(th);
      const end = Math.min(this.n, last + Math.ceil(tau * sr * 9.2));
      let y1 = 0;
      let y2 = 0;
      for (let i = first; i < end; i += 1) {
        const y = c * y1 - r2 * y2 + k * x[i];
        y2 = y1;
        y1 = y;
        target[i] += y;
      }
    }
  }

  finish(gain = 1) {
    this.modes(this.body, BODY, 1);
    let peak = 0;
    for (let i = 0; i < this.n; i += 1) peak = Math.max(peak, Math.abs(this.out[i]));
    const k = peak > 0 ? gain / peak : 0;
    const fade = Math.round(this.sr * 0.01);
    for (let i = 0; i < this.n; i += 1) {
      let v = this.out[i] * k;
      if (i > this.n - fade) v *= (this.n - i) / fade;
      this.out[i] = v;
    }
    return this.out;
  }
}

function strikeVoice(sr, seed) {
  const rand = rng(seed);
  const v = new Voice(sr, 0.36);
  const hard = 0.75 + rand() * 0.5;
  const tc = 0.00055 + (1 - hard) * 0.0005 + rand() * 0.0002;
  const at = 0.002;
  const hit = v.pulse(at, tc, 1, v.body);
  for (let i = 0; i < v.n; i += 1) v.body[i] *= 0.55;
  v.modes(hit, PLATEN, 1.25, v.out, 0.96 + rand() * 0.08);
  const f1 = 1750 + rand() * 900;
  const beam = BEAM.map((ratio, i) => [f1 * ratio * (1 + (rand() - 0.5) * 0.01), [0.026, 0.017, 0.01, 0.006][i] * (0.8 + rand() * 0.4), [0.32, 0.22, 0.13, 0.07][i]]);
  v.modes(hit, beam, 1);
  const slap = v.noise(at, 0.0025, 0.5 * hard, rand, 0.85, 0.25);
  for (let i = 0; i < v.n; i += 1) v.out[i] += slap[i];
  const back = 0.062 + rand() * 0.02;
  const thud = v.pulse(back, 0.004 + rand() * 0.002, 0.1, null);
  for (let i = 0; i < v.n; i += 1) v.body[i] += thud[i] * 0.7;
  v.modes(thud, PLATEN.slice(0, 2), 0.25);
  v.modes(v.pulse(back + 0.003, 0.0006, 0.05), beam.slice(0, 2), 0.4);
  return v.finish(0.92);
}

function keyVoice(sr, seed) {
  const rand = rng(seed);
  const v = new Voice(sr, 0.12);
  const finger = v.pulse(0.002, 0.003 + rand() * 0.002, 0.5, v.body);
  v.modes(finger, [[620 + rand() * 120, 0.006, 0.3]], 0.6);
  const link = v.pulse(0.006 + rand() * 0.004, 0.0005, 0.4);
  v.modes(link, [[1380 + rand() * 300, 0.009, 0.3], [2860 + rand() * 400, 0.006, 0.22], [4300 + rand() * 500, 0.004, 0.12]], 1);
  for (let i = 0; i < v.n; i += 1) v.body[i] *= 0.012;
  return v.finish(0.5);
}

function tickVoice(sr, seed, heavy = 0) {
  const rand = rng(seed);
  const v = new Voice(sr, 0.12);
  const tick = v.pulse(0.002, 0.00025 + rand() * 0.0001, 1, v.body);
  for (let i = 0; i < v.n; i += 1) v.body[i] *= 0.03 + heavy * 0.25;
  v.modes(tick, [[3100 + rand() * 300, 0.006, 0.4], [4720 + rand() * 400, 0.0045, 0.3], [6900 + rand() * 500, 0.003, 0.18]], 1);
  const step = v.pulse(0.004, 0.0015, 0.4 + heavy * 0.4, null);
  for (let i = 0; i < v.n; i += 1) v.body[i] += step[i] * (0.05 + heavy * 0.15);
  return v.finish(0.5 + heavy * 0.2);
}

function spaceVoice(sr, seed) {
  const rand = rng(seed);
  const v = new Voice(sr, 0.22);
  const bar = v.pulse(0.002, 0.005 + rand() * 0.002, 0.8, v.body);
  v.modes(bar, [[318 + rand() * 40, 0.02, 0.5], [652 + rand() * 60, 0.012, 0.32], [1024 + rand() * 80, 0.008, 0.2]], 1);
  const link = v.pulse(0.01, 0.0006, 0.3);
  v.modes(link, [[1500 + rand() * 300, 0.01, 0.25], [3100 + rand() * 300, 0.005, 0.15]], 1);
  const back = v.pulse(0.1 + rand() * 0.02, 0.004, 0.3, v.body);
  v.modes(back, [[330, 0.012, 0.3]], 0.6);
  for (let i = 0; i < v.n; i += 1) v.body[i] *= 0.5;
  return v.finish(0.62);
}

function bellVoice(sr, seed) {
  const rand = rng(seed);
  const v = new Voice(sr, 1.6);
  const f1 = 2240 + rand() * 120;
  const strikeX = v.pulse(0.002, 0.0004, 1);
  v.modes(strikeX, BELL.map(([ratio, tau, g]) => [f1 * ratio, tau, g]), 1);
  const tap = v.pulse(0.002, 0.0012, 0.3, v.body);
  v.modes(tap, [[5200, 0.003, 0.1]], 1);
  for (let i = 0; i < v.n; i += 1) v.body[i] *= 0.15;
  return v.finish(0.55);
}

function stopVoice(sr, seed) {
  const rand = rng(seed);
  const v = new Voice(sr, 0.5);
  const bang = v.pulse(0.002, 0.0011 + rand() * 0.0004, 1, v.body);
  v.modes(bang, [[905 + rand() * 60, 0.05, 0.4], [1712 + rand() * 80, 0.034, 0.28], [2630 + rand() * 120, 0.02, 0.16], [4100, 0.01, 0.08]], 1);
  v.modes(bang, PLATEN.slice(0, 2), 0.6);
  const rattle = v.pulse(0.034 + rand() * 0.01, 0.0008, 0.25, v.body);
  v.modes(rattle, [[2200 + rand() * 300, 0.012, 0.2]], 1);
  for (let i = 0; i < v.n; i += 1) v.body[i] *= 1.4;
  return v.finish(1);
}

function ratchetVoice(sr, seed) {
  const rand = rng(seed);
  const v = new Voice(sr, 0.16);
  const gap = 0.016 + rand() * 0.008;
  for (const [t, a] of [[0.002, 1], [0.002 + gap, 0.6]]) {
    const c = v.pulse(t, 0.0003, a, v.body);
    v.modes(c, [[2580 + rand() * 200, 0.008, 0.35], [3920 + rand() * 300, 0.005, 0.24], [5800 + rand() * 400, 0.003, 0.12]], 1);
  }
  const roll = v.pulse(0.004, 0.003, 0.3, v.body);
  v.modes(roll, PLATEN.slice(0, 1), 0.3);
  for (let i = 0; i < v.n; i += 1) v.body[i] *= 0.3;
  return v.finish(0.5);
}

function returnVoice(sr, seconds, seed) {
  const rand = rng(seed);
  const v = new Voice(sr, seconds + 0.12);
  const drive = new Float32Array(v.n);
  const len = Math.round(seconds * sr);
  let low = 0;
  let slow = 0;
  for (let i = 0; i < len; i += 1) {
    const u = i / len;
    const env = Math.min(1, u * 12) * Math.min(1, (1 - u) * 10) * (0.7 + 0.3 * Math.sin(u * 23 + rand()));
    low += (rand() * 2 - 1 - low) * 0.35;
    slow += (low - slow) * 0.01;
    drive[i] = (low - slow) * env * 0.05;
  }
  v.modes(drive, BODY.slice(3, 12), 1);
  for (let i = 0; i < v.n; i += 1) v.body[i] += drive[i] * 0.2;
  let t = 0.01;
  while (t < seconds - 0.01) {
    const u = t / seconds;
    const speed = Math.min(1, u * 3 + 0.25);
    const c = v.pulse(t, 0.0002, (0.18 + rand() * 0.12) * speed);
    v.modes(c, [[3300 + rand() * 600, 0.0035, 0.3], [5100 + rand() * 600, 0.0025, 0.16]], 1);
    t += 0.0075 / speed + rand() * 0.0025;
  }
  return v.finish(0.42);
}

function makeRoom(ctx) {
  const seconds = 0.5;
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let c = 0; c < 2; c += 1) {
    const data = buffer.getChannelData(c);
    const rand = rng(4049 + c * 131);
    let low = 0;
    for (let i = 0; i < length; i += 1) {
      const t = i / ctx.sampleRate;
      low += (rand() * 2 - 1 - low) * (0.5 - 0.42 * Math.min(1, t / seconds));
      const early = t > 0.004 && t < 0.035 && rand() > 0.985 ? (rand() - 0.5) * 2.4 : 0;
      data[i] = (low * Math.exp(-t / 0.09) * 0.5 + early * Math.exp(-t / 0.02)) * 0.6;
    }
  }
  return buffer;
}

const STRIKES = 16;
const RATE = 48000;

const KINDS = {
  strike: [STRIKES, strikeVoice, 101],
  key: [6, keyVoice, 307],
  tick: [6, (r, s) => tickVoice(r, s, 0), 509],
  step: [3, (r, s) => tickVoice(r, s, 1), 613],
  space: [4, spaceVoice, 709],
  ratchet: [4, ratchetVoice, 811],
  stop: [3, stopVoice, 907],
  bell: [2, bellVoice, 1009],
};

export default class TypewriterSound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.voices = {};
    this.buffers = {};
    this.returns = new Map();
    this.last = { strike: -1, key: -1, tick: -1 };
    this.jobs = [];
    for (const kind of ["strike", "key", "tick", "step", "space", "ratchet", "stop", "bell"]) {
      this.voices[kind] = new Array(KINDS[kind][0]).fill(null);
      this.buffers[kind] = new Array(KINDS[kind][0]).fill(null);
      for (let i = 0; i < KINDS[kind][0]; i += 1) this.jobs.push([kind, i]);
    }
    this.zips = new Map();
    for (let d = 2; d <= 10; d += 1) this.jobs.push(["zip", d / 20]);
    this.idle = 0;
  }

  prepare() {
    if (this.idle || !this.jobs.length || typeof window === "undefined") return;
    const run = (deadline) => {
      this.idle = 0;
      const until = performance.now() + 8;
      while (this.jobs.length && (deadline?.timeRemaining ? deadline.timeRemaining() > 2 : performance.now() < until)) {
        const [kind, i] = this.jobs.shift();
        if (kind === "zip") this.zip(i);
        else this.voice(kind, i);
      }
      this.prepare();
    };
    this.idle = window.requestIdleCallback ? window.requestIdleCallback(run, { timeout: 200 }) : window.setTimeout(run, 16);
  }

  voice(kind, i) {
    const list = this.voices[kind];
    if (!list[i]) {
      const [, fn, base] = KINDS[kind];
      list[i] = fn(RATE, base + i * 7919);
    }
    return list[i];
  }

  zip(d) {
    if (!this.zips.has(d)) this.zips.set(d, returnVoice(RATE, d, 1201 + Math.round(d * 100)));
    return this.zips.get(d);
  }

  sample(kind, i) {
    const list = this.buffers[kind];
    if (!list[i]) list[i] = this.buffer(this.voice(kind, i));
    return list[i];
  }

  unlock() {
    if (!this.enabled) return;
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      try {
        this.ctx = new Ctx({ latencyHint: "interactive" });
      } catch {
        this.ctx = null;
        return;
      }
      const ctx = this.ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 10;
      comp.ratio.value = 3;
      comp.attack.value = 0.001;
      comp.release.value = 0.12;
      const lowCut = ctx.createBiquadFilter();
      lowCut.type = "highpass";
      lowCut.frequency.value = 70;
      const shelf = ctx.createBiquadFilter();
      shelf.type = "highshelf";
      shelf.frequency.value = 7000;
      shelf.gain.value = -4;
      comp.connect(lowCut);
      lowCut.connect(shelf);
      shelf.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.gain.value = 0.7;
      this.master.connect(comp);
      const room = ctx.createConvolver();
      room.buffer = makeRoom(ctx);
      const wet = ctx.createGain();
      wet.gain.value = 0.2;
      this.master.connect(room);
      room.connect(wet);
      wet.connect(comp);
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
  }

  buffer(data) {
    const b = this.ctx.createBuffer(1, data.length, RATE);
    b.getChannelData(0).set(data);
    return b;
  }

  setEnabled(on) {
    this.enabled = on;
    if (on) this.unlock();
    else if (this.ctx && this.ctx.state === "running") this.ctx.suspend().catch(() => {});
  }

  ready() {
    return this.enabled && this.ctx && this.ctx.state === "running";
  }

  play(buffer, { at = 0, gain = 1, pan = 0, rate = 1 } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      g.connect(p);
      p.connect(this.master);
    } else g.connect(this.master);
    src.start(ctx.currentTime + 0.003 + at);
  }

  pick(kind, avoidKey) {
    const n = KINDS[kind][0];
    let i = Math.floor(Math.random() * n);
    if (avoidKey && n > 1 && i === this.last[avoidKey]) i = (i + 1) % n;
    if (avoidKey) this.last[avoidKey] = i;
    return this.sample(kind, i);
  }

  key(pan = 0) {
    if (!this.ready()) return;
    this.play(this.pick("key", "key"), { gain: 0.5 + Math.random() * 0.2, pan: pan * 0.5, rate: 0.97 + Math.random() * 0.06 });
  }

  strike(force, pan, jitter, bar = -1) {
    if (!this.ready()) return;
    const f = Math.max(0.5, Math.min(1.3, force));
    const i = bar >= 0 ? bar % STRIKES : Math.floor(Math.random() * STRIKES);
    this.play(this.sample("strike", i), {
      at: Math.random() * 0.002,
      gain: (0.62 + 0.3 * f) * (0.9 + Math.random() * 0.2),
      pan,
      rate: 0.985 + jitter * 0.02 + Math.random() * 0.02,
    });
  }

  escape(delay = 0) {
    if (!this.ready()) return;
    this.play(this.pick("tick", "tick"), { at: delay + Math.random() * 0.004, gain: 0.42 + Math.random() * 0.12, pan: -0.35, rate: 0.97 + Math.random() * 0.06 });
  }

  space() {
    if (!this.ready()) return;
    this.play(this.pick("space"), { gain: 0.7, rate: 0.97 + Math.random() * 0.05 });
    this.play(this.pick("step"), { at: 0.032 + Math.random() * 0.006, gain: 0.45, pan: -0.35 });
  }

  backspace() {
    if (!this.ready()) return;
    this.play(this.pick("key", "key"), { gain: 0.55, pan: 0.3 });
    this.play(this.pick("tick"), { at: 0.026, gain: 0.4, pan: -0.35, rate: 0.9 });
    this.play(this.pick("tick"), { at: 0.046, gain: 0.3, pan: -0.35, rate: 1.04 });
  }

  ratchet(gain = 1) {
    if (!this.ready()) return;
    this.play(this.pick("ratchet"), { gain: 0.62 * gain * (0.9 + Math.random() * 0.2), pan: -0.55, rate: 0.96 + Math.random() * 0.08 });
  }

  slide(duration) {
    if (!this.ready()) return;
    const d = Math.min(0.9, Math.max(0.1, Math.round(duration * 20) / 20));
    let buffer = this.returns.get(d);
    if (!buffer) {
      buffer = this.buffer(this.zip(d));
      this.returns.set(d, buffer);
    }
    this.play(buffer, { gain: 0.8, pan: -0.2, rate: 0.98 + Math.random() * 0.04 });
  }

  thunk(strength) {
    if (!this.ready()) return;
    const s = Math.max(0.2, Math.min(1, strength));
    this.play(this.pick("stop"), { gain: 0.35 + 0.65 * s, pan: -0.6, rate: 0.97 + Math.random() * 0.05 });
  }

  bell() {
    if (!this.ready()) return;
    this.play(this.pick("bell"), { gain: 0.55, pan: 0.55, rate: 0.995 + Math.random() * 0.01 });
  }

  destroy() {
    if (this.idle) (window.cancelIdleCallback || window.clearTimeout)(this.idle);
    this.idle = 0;
    this.jobs = [];
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}

const sr = 48000;
const env = (a, ms = 4) => { const out = []; const w = Math.round(sr * ms / 1000); for (let i = 0; i < a.length; i += w) { let p = 0; for (let j = i; j < Math.min(a.length, i + w); j++) p = Math.max(p, Math.abs(a[j])); out.push((20 * Math.log10(p + 1e-9)).toFixed(0)); } return out.join(" "); };
for (const [name, fn] of [["strike", strikeVoice], ["key", keyVoice], ["tick", (r, s) => tickVoice(r, s, 0)], ["space", spaceVoice], ["ratchet", ratchetVoice], ["stop", stopVoice]]) console.log(name.padEnd(8), env(fn(sr, 101)).split(" ").slice(0, 60).join(" "));
