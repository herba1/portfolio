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
      const length = Math.floor(ctx.sampleRate * 0.6);
      this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      let seed = 1234567;
      for (let i = 0; i < length; i += 1) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        data[i] = (seed / 4294967296) * 2 - 1;
      }
      this.master = ctx.createGain();
      this.master.gain.value = 0.7;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.knee.value = 8;
      comp.ratio.value = 4;
      comp.attack.value = 0.002;
      comp.release.value = 0.12;
      this.master.connect(comp);
      comp.connect(ctx.destination);
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

  burst(at, { freq, q = 1, type = "bandpass", gain, decay, offset = 0, pan = 0, duration = 0.08 }) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.0015);
    g.gain.setTargetAtTime(0, at + 0.0015, decay);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.out(pan));
    src.start(at, Math.min(0.5, Math.max(0, offset)), duration + decay * 6);
    src.stop(at + duration + decay * 6);
  }

  tone(at, { freq, gain, decay, pan = 0, type = "sine" }) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.002);
    g.gain.setTargetAtTime(0, at + 0.002, decay);
    o.connect(g);
    g.connect(this.out(pan));
    o.start(at);
    o.stop(at + decay * 7 + 0.02);
  }

  strike(force, pan, jitter) {
    if (!this.ready()) return;
    const at = this.ctx.currentTime + 0.004;
    const f = Math.max(0.5, Math.min(1.3, force));
    this.burst(at, { freq: 2600 + jitter * 900, q: 1.4, gain: 0.55 * f, decay: 0.012, offset: 0.05 + (jitter + 0.5) * 0.3, pan, duration: 0.02 });
    this.burst(at, { freq: 5200 + jitter * 1200, q: 2.5, gain: 0.18 * f, decay: 0.006, offset: 0.3 + jitter * 0.2, pan, duration: 0.01 });
    this.burst(at, { freq: 420, q: 0.8, type: "lowpass", gain: 0.5 * f, decay: 0.022, offset: 0.1, pan: pan * 0.5, duration: 0.03 });
    this.tone(at, { freq: 118 + jitter * 20, gain: 0.22 * f, decay: 0.03 });
    this.tone(at + 0.001, { freq: 3150 + jitter * 400, gain: 0.025 * f, decay: 0.02, pan });
  }

  escape() {
    if (!this.ready()) return;
    const at = this.ctx.currentTime + 0.002;
    this.burst(at, { freq: 4200, q: 3, gain: 0.08, decay: 0.004, offset: 0.33, duration: 0.008 });
  }

  space() {
    if (!this.ready()) return;
    const at = this.ctx.currentTime + 0.003;
    this.burst(at, { freq: 900, q: 0.9, gain: 0.28, decay: 0.02, offset: 0.27, duration: 0.03 });
    this.tone(at, { freq: 96, gain: 0.16, decay: 0.035 });
    this.burst(at + 0.05, { freq: 3800, q: 3, gain: 0.07, decay: 0.004, offset: 0.41, duration: 0.008 });
  }

  backspace() {
    if (!this.ready()) return;
    const at = this.ctx.currentTime + 0.003;
    this.burst(at, { freq: 1800, q: 1.2, gain: 0.26, decay: 0.014, offset: 0.12, duration: 0.02 });
    this.burst(at + 0.03, { freq: 3400, q: 2, gain: 0.1, decay: 0.006, offset: 0.5, duration: 0.01 });
  }

  ratchet(gain = 1) {
    if (!this.ready()) return;
    const at = this.ctx.currentTime + 0.002;
    this.burst(at, { freq: 3000, q: 2.2, gain: 0.16 * gain, decay: 0.006, offset: 0.37, duration: 0.01, pan: -0.5 });
    this.burst(at + 0.018, { freq: 2400, q: 2, gain: 0.1 * gain, decay: 0.008, offset: 0.45, duration: 0.01, pan: -0.5 });
  }

  slide(duration) {
    if (!this.ready()) return;
    const ctx = this.ctx;
    const at = ctx.currentTime + 0.004;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 1.6;
    filter.frequency.setValueAtTime(700, at);
    filter.frequency.linearRampToValueAtTime(1500, at + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(0.09, at + 0.03);
    g.gain.setValueAtTime(0.09, at + Math.max(0.04, duration - 0.04));
    g.gain.linearRampToValueAtTime(0, at + duration);
    src.connect(filter);
    filter.connect(g);
    g.connect(this.out(0.2));
    src.start(at);
    src.stop(at + duration + 0.05);
  }

  thunk(strength) {
    if (!this.ready()) return;
    const s = Math.max(0.2, Math.min(1, strength));
    const at = this.ctx.currentTime + 0.002;
    this.burst(at, { freq: 600, q: 0.7, type: "lowpass", gain: 0.55 * s, decay: 0.03, offset: 0.05, duration: 0.04, pan: -0.6 });
    this.burst(at, { freq: 2200, q: 1.1, gain: 0.3 * s, decay: 0.012, offset: 0.21, duration: 0.02, pan: -0.6 });
    this.tone(at, { freq: 82, gain: 0.3 * s, decay: 0.05, pan: -0.4 });
  }

  bell() {
    if (!this.ready()) return;
    const at = this.ctx.currentTime + 0.003;
    const base = 2093;
    const partials = [
      [1, 0.16, 0.9],
      [2.76, 0.07, 0.42],
      [5.4, 0.035, 0.2],
      [8.93, 0.018, 0.1],
    ];
    for (const [ratio, gain, decay] of partials) this.tone(at, { freq: base * ratio, gain, decay, pan: 0.55 });
    this.burst(at, { freq: 6000, q: 2, gain: 0.05, decay: 0.004, offset: 0.3, duration: 0.006, pan: 0.55 });
  }

  destroy() {
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
