export default class PosterSound {
  constructor() {
    this.ctx = null;
    this.noise = null;
  }

  unlock() {
    if (this.ctx) {
      if (this.ctx.state === "suspended") this.ctx.resume().catch(() => {});
      return;
    }
    const Context = window.AudioContext || window.webkitAudioContext;
    if (!Context) return;
    this.ctx = new Context();
    const length = this.ctx.sampleRate * 2;
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < length; i += 1) {
      const white = Math.random() * 2 - 1;
      brown = (brown + white * 0.06) * 0.99;
      data[i] = brown * 2.2 + white * 0.25;
    }
    this.noise = buffer;
  }

  stroke(duration, strength = 1) {
    const ctx = this.ctx;
    if (!ctx || !this.noise || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.setValueAtTime(520, now);
    band.frequency.linearRampToValueAtTime(760, now + duration);
    band.Q.value = 0.9;
    const gain = ctx.createGain();
    const peak = 0.11 * strength;
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(peak, now + 0.08);
    gain.gain.setValueAtTime(peak, now + duration * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration + 0.06);
    source.connect(band).connect(gain).connect(ctx.destination);
    source.start(now, Math.random());
    source.stop(now + duration + 0.1);
  }

  close() {
    this.ctx?.close().catch(() => {});
    this.ctx = null;
  }
}
