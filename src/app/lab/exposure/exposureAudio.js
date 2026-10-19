export function createExposureAudio() {
  const Ctx = typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext : null;
  let ctx = null;
  let master = null;
  let noise = null;
  let enabled = false;
  let voice = 0;
  let last = 0;

  const build = () => {
    ctx = new Ctx({ latencyHint: "interactive" });
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 10;
    comp.ratio.value = 5;
    comp.attack.value = 0.002;
    comp.release.value = 0.1;
    comp.connect(ctx.destination);
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(comp);
    const length = Math.floor(ctx.sampleRate * 0.4);
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let seed = 20231;
    for (let i = 0; i < length; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 4294967296) * 2 - 1;
    }
  };

  const hit = (freq, q, peak, len, offset, type = "bandpass", delay = 0) => {
    const now = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(peak, now + 0.0007);
    env.gain.exponentialRampToValueAtTime(0.0001, now + len);
    src.connect(f);
    f.connect(env);
    env.connect(master);
    src.start(now, offset, len + 0.01);
    src.onended = () => env.disconnect();
  };

  return {
    get enabled() {
      return enabled;
    },
    async setEnabled(on) {
      if (!Ctx) return false;
      enabled = on;
      if (on) {
        if (!ctx) build();
        if (ctx.state !== "running") await ctx.resume().catch(() => {});
        return ctx.state === "running";
      }
      if (ctx && ctx.state === "running") await ctx.suspend().catch(() => {});
      return false;
    },
    detent(speed, major, stop) {
      if (!enabled || !ctx || ctx.state !== "running") return;
      const now = ctx.currentTime;
      if (now - last < 0.012) return;
      last = now;
      voice = (voice + 1) % 17;
      const level = Math.min(1, 0.45 + speed * 0.04);
      const offset = ((voice * 0.0191) % 0.3) + 0.01;
      hit(4200 + voice * 60 + (major ? -600 : 0), 2.4, 0.2 * level, 0.012, offset);
      hit(major ? 1500 : 1900 + voice * 15, 4, (major ? 0.16 : 0.1) * level, major ? 0.03 : 0.02, offset + 0.05);
      if (stop) hit(320, 1.2, 0.22, 0.06, offset + 0.1, "lowpass");
    },
    shutter() {
      if (!enabled || !ctx || ctx.state !== "running") return;
      hit(3000, 1.6, 0.24, 0.016, 0.02);
      hit(700, 1.4, 0.2, 0.04, 0.08, "lowpass");
      hit(2200, 2.2, 0.16, 0.022, 0.15, "bandpass", 0.085);
      hit(420, 1.2, 0.18, 0.05, 0.2, "lowpass", 0.09);
    },
    destroy() {
      enabled = false;
      if (ctx) ctx.close().catch(() => {});
      ctx = null;
    },
  };
}
