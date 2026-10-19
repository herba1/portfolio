export function createSortSound() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: "interactive" });
  const length = Math.floor(ctx.sampleRate * 2);
  const noise = ctx.createBuffer(2, length, ctx.sampleRate);
  let seed = 90210;
  for (let c = 0; c < 2; c += 1) {
    const data = noise.getChannelData(c);
    let brown = 0;
    for (let i = 0; i < length; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const white = (seed / 4294967296) * 2 - 1;
      brown = brown * 0.86 + white * 0.14;
      data[i] = white * 0.55 + brown * 1.6;
    }
  }
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.12;
  master.connect(comp);
  comp.connect(ctx.destination);

  const src = ctx.createBufferSource();
  src.buffer = noise;
  src.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 1400;
  band.Q.value = 1.1;
  const air = ctx.createBiquadFilter();
  air.type = "highshelf";
  air.frequency.value = 5000;
  air.gain.value = -8;
  const level = ctx.createGain();
  level.gain.value = 0;
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
  src.connect(band);
  band.connect(air);
  air.connect(level);
  level.connect(pan);
  pan.connect(master);
  let started = false;
  let enabled = false;
  let voice = 0;

  const tick = (freq, gain, dur) => {
    const now = ctx.currentTime;
    voice = (voice + 1) % 89;
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = 2.4;
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, now);
    e.gain.exponentialRampToValueAtTime(gain, now + 0.002);
    e.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    s.connect(f);
    f.connect(e);
    e.connect(master);
    s.start(now, (voice * 0.017) % 1.5, dur + 0.02);
    s.onended = () => e.disconnect();
  };

  return {
    async setEnabled(on) {
      enabled = on;
      if (on) {
        if (ctx.state !== "running") await ctx.resume().catch(() => {});
        if (!started) {
          src.start();
          started = true;
        }
      } else if (ctx.state === "running") {
        level.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
        await ctx.suspend().catch(() => {});
      }
      return enabled && ctx.state === "running";
    },
    drag(speed, y, x, up) {
      if (!enabled || ctx.state !== "running") return;
      const now = ctx.currentTime;
      const s = Math.min(1, speed);
      level.gain.setTargetAtTime(0.42 * Math.pow(s, 0.8), now, 0.03);
      band.frequency.setTargetAtTime((up ? 700 : 1000) + 2600 * s + 500 * (1 - y), now, 0.04);
      if (pan.pan) pan.pan.setTargetAtTime(Math.max(-0.7, Math.min(0.7, x * 1.4 - 0.7)), now, 0.05);
    },
    release() {
      if (!enabled || ctx.state !== "running") return;
      level.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
    },
    click() {
      if (!enabled || ctx.state !== "running") return;
      tick(2600, 0.18, 0.02);
      tick(700, 0.12, 0.04);
    },
    sweep() {
      if (!enabled || ctx.state !== "running") return;
      const now = ctx.currentTime;
      const s = ctx.createBufferSource();
      s.buffer = noise;
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = 1.4;
      f.frequency.setValueAtTime(3200, now);
      f.frequency.exponentialRampToValueAtTime(600, now + 0.45);
      const e = ctx.createGain();
      e.gain.setValueAtTime(0.0001, now);
      e.gain.exponentialRampToValueAtTime(0.22, now + 0.04);
      e.gain.exponentialRampToValueAtTime(0.0001, now + 0.5);
      s.connect(f);
      f.connect(e);
      e.connect(master);
      s.start(now, 0.3, 0.55);
      s.onended = () => e.disconnect();
    },
    destroy() {
      enabled = false;
      ctx.close().catch(() => {});
    },
  };
}
