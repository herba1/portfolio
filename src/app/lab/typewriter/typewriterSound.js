function makeNoise(ctx, seconds, seed0) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let seed = seed0;
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 4294967296) * 2 - 1;
  }
  return buffer;
}

function makeRoom(ctx) {
  const seconds = 0.42;
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let c = 0; c < 2; c += 1) {
    const data = buffer.getChannelData(c);
    let seed = 99991 + c * 7919;
    let low = 0;
    for (let i = 0; i < length; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const n = (seed / 4294967296) * 2 - 1;
      const t = i / ctx.sampleRate;
      low += (n - low) * (0.32 - 0.24 * Math.min(1, t / seconds));
      const early = t < 0.03 ? 0.4 * Math.exp(-t / 0.004) * (i % 37 === 0 ? 3 : 0.2) : 0;
      data[i] = (low * Math.exp(-t / 0.075) + early * n) * 0.6;
    }
  }
  return buffer;
}

const vary = (amount) => 1 + (Math.random() * 2 - 1) * amount;

export default class TypewriterSound {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.noise = null;
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
      this.noise = makeNoise(ctx, 0.8, 1234567);
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 10;
      comp.ratio.value = 3.5;
      comp.attack.value = 0.002;
      comp.release.value = 0.14;
      const tone = ctx.createBiquadFilter();
      tone.type = "highshelf";
      tone.frequency.value = 6500;
      tone.gain.value = -5;
      comp.connect(tone);
      tone.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.gain.value = 0.62;
      this.master.connect(comp);
      const room = ctx.createConvolver();
      room.buffer = makeRoom(ctx);
      const wet = ctx.createGain();
      wet.gain.value = 0.22;
      this.master.connect(room);
      room.connect(wet);
      wet.connect(comp);
    }
    if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
  }

  setEnabled(on) {
    this.enabled = on;
    if (on) this.unlock();
    else if (this.ctx && this.ctx.state === "running") this.ctx.suspend().catch(() => {});
  }

  ready() {
    return this.enabled && this.ctx && this.ctx.state === "running";
  }

  out(pan) {
    const ctx = this.ctx;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      p.connect(this.master);
      return p;
    }
    return this.master;
  }

  burst(at, { freq, q = 1, type = "bandpass", gain, decay, pan = 0, duration = 0.02 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.0008);
    g.gain.setTargetAtTime(0, at + 0.0008, decay);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.out(pan));
    const length = duration + decay * 7;
    src.start(at, Math.random() * 0.7, length);
    src.stop(at + length);
  }

  ring(at, { freq, gain, decay, pan = 0, drop = 1 }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(freq, at);
    if (drop !== 1) o.frequency.exponentialRampToValueAtTime(freq * drop, at + decay * 2.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.001);
    g.gain.setTargetAtTime(0, at + 0.001, decay);
    o.connect(g);
    g.connect(this.out(pan));
    o.start(at);
    o.stop(at + decay * 8 + 0.02);
  }

  tick(at, { gain = 0.1, pan = 0, pitch = 1 }) {
    this.burst(at, { freq: 4300 * pitch * vary(0.08), q: 3.2, gain, decay: 0.0025, pan, duration: 0.003 });
    this.ring(at, { freq: 3150 * pitch * vary(0.03), gain: gain * 0.16, decay: 0.012, pan });
  }

  key(pan = 0) {
    if (!this.ready()) return;
    const at = this.ctx.currentTime + 0.003;
    this.burst(at, { freq: 2100 * vary(0.12), q: 1.6, gain: 0.07 * vary(0.2), decay: 0.004, pan: pan * 0.4, duration: 0.004 });
    this.burst(at + 0.006, { freq: 520 * vary(0.1), q: 0.8, type: "lowpass", gain: 0.09 * vary(0.2), decay: 0.012, pan: pan * 0.4, duration: 0.01 });
  }

  strike(force, pan, jitter) {
    if (!this.ready()) return;
    const at = this.ctx.currentTime + 0.003 + Math.random() * 0.003;
    const f = Math.max(0.5, Math.min(1.3, force)) * vary(0.12);
    const id = 1 + jitter * 0.09;
    this.burst(at, { freq: 2600 * id * vary(0.06), q: 0.9, gain: 0.62 * f, decay: 0.0045, pan, duration: 0.004 });
    this.burst(at, { freq: 6200 * vary(0.08), q: 1.8, gain: 0.16 * f, decay: 0.002, pan, duration: 0.002 });
    this.burst(at + 0.0006, { freq: 900 * vary(0.08), q: 0.7, type: "lowpass", gain: 0.42 * f, decay: 0.016, pan: pan * 0.6, duration: 0.012 });
    this.ring(at, { freq: 230 * id * vary(0.04), gain: 0.3 * f, decay: 0.022, pan: pan * 0.4, drop: 0.55 });
    const base = 1680 * id * vary(0.015);
    const modes = [
      [1, 0.042, 0.05],
      [1.94, 0.03, 0.034],
      [2.91, 0.018, 0.024],
      [4.17, 0.011, 0.015],
    ];
    for (const [ratio, gain, decay] of modes) {
      this.ring(at, { freq: base * ratio * vary(0.01), gain: gain * f, decay: decay * vary(0.15), pan });
    }
    this.ring(at + 0.001, { freq: 142 * vary(0.03), gain: 0.1 * f, decay: 0.06, pan: pan * 0.3 });
    const back = at + 0.07 + Math.random() * 0.014;
    this.burst(back, { freq: 460 * vary(0.1), q: 0.8, type: "lowpass", gain: 0.12 * f, decay: 0.014, pan: pan * 0.8, duration: 0.01 });
    this.burst(back + 0.004, { freq: 1300 * vary(0.12), q: 1.4, gain: 0.04 * f, decay: 0.006, pan: pan * 0.8, duration: 0.005 });
  }

  escape(delay = 0) {
    if (!this.ready()) return;
    const at = this.ctx.currentTime + 0.003 + delay + Math.random() * 0.004;
    this.tick(at, { gain: 0.085 * vary(0.2), pan: -0.35 });
  }

  space() {
    if (!this.ready()) return;
    const at = this.ctx.currentTime + 0.003;
    this.burst(at, { freq: 1500 * vary(0.1), q: 1.2, gain: 0.08, decay: 0.004, duration: 0.004 });
    this.burst(at + 0.008, { freq: 640 * vary(0.08), q: 0.7, type: "lowpass", gain: 0.32 * vary(0.12), decay: 0.024, duration: 0.02 });
    this.ring(at + 0.008, { freq: 120 * vary(0.05), gain: 0.18, decay: 0.035, drop: 0.7 });
    this.tick(at + 0.04, { gain: 0.08 * vary(0.2), pan: -0.35 });
    this.burst(at + 0.1 + Math.random() * 0.02, { freq: 520, q: 0.8, type: "lowpass", gain: 0.1, decay: 0.012, duration: 0.008 });
  }

  backspace() {
    if (!this.ready()) return;
    const at = this.ctx.currentTime + 0.003;
    this.burst(at, { freq: 1900 * vary(0.1), q: 1.4, gain: 0.1, decay: 0.004, duration: 0.004, pan: 0.3 });
    this.burst(at + 0.006, { freq: 600, q: 0.8, type: "lowpass", gain: 0.16, decay: 0.014, duration: 0.01, pan: 0.3 });
    this.tick(at + 0.03, { gain: 0.08, pan: -0.35, pitch: 0.9 });
    this.tick(at + 0.05, { gain: 0.05, pan: -0.35, pitch: 1.05 });
  }

  ratchet(gain = 1) {
    if (!this.ready()) return;
    const at = this.ctx.currentTime + 0.002;
    const g = gain * vary(0.15);
    this.tick(at, { gain: 0.11 * g, pan: -0.55, pitch: 0.72 });
    this.burst(at + 0.001, { freq: 700, q: 0.8, type: "lowpass", gain: 0.1 * g, decay: 0.01, duration: 0.006, pan: -0.55 });
    this.tick(at + 0.021 + Math.random() * 0.006, { gain: 0.07 * g, pan: -0.55, pitch: 0.66 });
  }

  slide(duration) {
    if (!this.ready()) return;
    const ctx = this.ctx;
    const at = ctx.currentTime + 0.004;
    const d = Math.max(0.06, duration);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 1.3;
    filter.frequency.setValueAtTime(650, at);
    filter.frequency.linearRampToValueAtTime(1350, at + d);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.1, at + 0.03);
    g.gain.setValueAtTime(0.1, at + Math.max(0.04, d - 0.04));
    g.gain.linearRampToValueAtTime(0, at + d);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.out(-0.2));
    src.start(at, Math.random() * 0.5);
    src.stop(at + d + 0.05);
    const teeth = Math.min(48, Math.floor(d / 0.011));
    for (let i = 0; i < teeth; i += 1) {
      const u = i / Math.max(1, teeth);
      const t = at + 0.02 + (d - 0.03) * (1 - Math.pow(1 - u, 1.4));
      this.burst(t, { freq: 3600 * vary(0.12), q: 3, gain: 0.05 * vary(0.4) * (0.6 + 0.4 * Math.sin(u * Math.PI)), decay: 0.0018, duration: 0.002, pan: -0.5 + u * 0.8 });
    }
  }

  thunk(strength) {
    if (!this.ready()) return;
    const s = Math.max(0.2, Math.min(1, strength)) * vary(0.1);
    const at = this.ctx.currentTime + 0.002;
    this.burst(at, { freq: 2400 * vary(0.06), q: 1, gain: 0.32 * s, decay: 0.005, duration: 0.004, pan: -0.65 });
    this.burst(at, { freq: 700, q: 0.7, type: "lowpass", gain: 0.55 * s, decay: 0.03, duration: 0.03, pan: -0.65 });
    this.ring(at, { freq: 150 * vary(0.04), gain: 0.36 * s, decay: 0.05, pan: -0.5, drop: 0.5 });
    this.ring(at, { freq: 880 * vary(0.03), gain: 0.05 * s, decay: 0.07, pan: -0.65 });
    this.ring(at, { freq: 1730 * vary(0.03), gain: 0.03 * s, decay: 0.05, pan: -0.65 });
    this.ring(at + 0.002, { freq: 95, gain: 0.14 * s, decay: 0.09, pan: -0.3 });
  }

  bell() {
    if (!this.ready()) return;
    const at = this.ctx.currentTime + 0.003;
    const base = 2280 * vary(0.01);
    const partials = [
      [1, 0.08, 0.7],
      [1.0035, 0.04, 0.6],
      [2.38, 0.034, 0.3],
      [4.06, 0.018, 0.15],
      [6.12, 0.008, 0.07],
    ];
    for (const [ratio, gain, decay] of partials) this.ring(at, { freq: base * ratio, gain, decay, pan: 0.55 });
    this.burst(at, { freq: 5200, q: 2, gain: 0.06, decay: 0.003, duration: 0.003, pan: 0.55 });
  }

  destroy() {
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
