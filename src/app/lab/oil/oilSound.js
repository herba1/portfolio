export default class OilSound {
  constructor() {
    this.ctx = null;
    this.gain = null;
    this.band = null;
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
    const length = ctx.sampleRate * 3;
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      brown = (brown + white * 0.05) * 0.985;
      const grain = Math.random() < 0.004 ? (Math.random() * 2 - 1) * 0.6 : 0;
      data[i] = brown * 1.8 + white * 0.12 + grain;
    }
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 900;
    band.Q.value = 0.7;
    const low = ctx.createBiquadFilter();
    low.type = "lowpass";
    low.frequency.value = 3200;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    source.connect(band).connect(low).connect(gain).connect(ctx.destination);
    source.start();
    this.band = band;
    this.gain = gain;
  }

  setSpeed(speed) {
    const ctx = this.ctx;
    if (!ctx || !this.gain || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const amount = Math.min(1, speed / 900);
    this.gain.gain.setTargetAtTime(amount > 0.02 ? 0.02 + amount * 0.07 : 0, now, 0.05);
    this.band.frequency.setTargetAtTime(600 + amount * 900, now, 0.08);
  }

  close() {
    this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.gain = null;
  }
}
