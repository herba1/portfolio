export default class PlotterSound {
  constructor() {
    this.ctx = null;
    this.gain = null;
    this.plotting = false;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      return;
    }
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    const ctx = new Context();
    this.ctx = ctx;
    const length = ctx.sampleRate * 2;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      brown = (brown + white * 0.08) * 0.985;
      data[i] = white * 0.55 + brown * 1.6;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 2600;
    band.Q.value = 0.6;
    const shelf = ctx.createBiquadFilter();
    shelf.type = "highpass";
    shelf.frequency.value = 900;
    const flutter = ctx.createGain();
    flutter.gain.value = 0.75;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 7.3;
    const depth = ctx.createGain();
    depth.gain.value = 0.25;
    lfo.connect(depth).connect(flutter.gain);
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    source.connect(shelf).connect(band).connect(flutter).connect(this.gain).connect(ctx.destination);
    source.start();
    lfo.start();
    if (this.plotting) this.setPlotting(true, true);
  }

  setPlotting(on, force = false) {
    if (on === this.plotting && !force) return;
    this.plotting = on;
    const ctx = this.ctx;
    if (!ctx || !this.gain) return;
    const now = ctx.currentTime;
    this.gain.gain.cancelScheduledValues(now);
    this.gain.gain.setTargetAtTime(on ? 0.05 : 0, now, on ? 0.06 : 0.04);
    if (on) this.tick(now);
  }

  tick(at) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(1800, at);
    osc.frequency.exponentialRampToValueAtTime(700, at + 0.03);
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(0.035, at + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    osc.connect(env).connect(ctx.destination);
    osc.start(at);
    osc.stop(at + 0.06);
  }

  close() {
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.gain = null;
  }
}
