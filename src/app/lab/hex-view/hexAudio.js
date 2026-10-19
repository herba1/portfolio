export function createKeys() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: "interactive" });
  const length = Math.floor(ctx.sampleRate * 0.3);
  const noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  let seed = 4242;
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 4294967296) * 2 - 1;
  }
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 5;
  comp.attack.value = 0.002;
  comp.release.value = 0.1;
  master.connect(comp);
  comp.connect(ctx.destination);
  let enabled = false;
  let voice = 0;
  let lastTick = 0;

  const burst = (freq, q, gain, dur, offset, delay = 0) => {
    const now = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.frequency.value = freq;
    f.Q.value = q;
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, now);
    e.gain.exponentialRampToValueAtTime(gain, now + 0.0012);
    e.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(f);
    f.connect(e);
    e.connect(master);
    src.start(now, offset, dur + 0.02);
    src.onended = () => e.disconnect();
  };

  return {
    async setEnabled(on) {
      enabled = on;
      if (on && ctx.state !== "running") await ctx.resume().catch(() => {});
      if (!on && ctx.state === "running") await ctx.suspend().catch(() => {});
      return enabled && ctx.state === "running";
    },
    key() {
      if (!enabled || ctx.state !== "running") return;
      voice = (voice + 1) % 97;
      const v = (voice * 37) % 11;
      const off = ((voice * 0.023) % 0.25) + 0.01;
      burst(2400 + v * 80, 1.4, 0.32, 0.018, off);
      burst(380 + v * 14, 3.5, 0.24, 0.05, off + 0.03, 0.004);
      burst(5200 + v * 60, 2, 0.08, 0.01, off + 0.05, 0.026);
    },
    tick() {
      if (!enabled || ctx.state !== "running") return;
      const now = ctx.currentTime;
      if (now - lastTick < 0.03) return;
      lastTick = now;
      voice = (voice + 1) % 97;
      burst(4200 + ((voice * 29) % 7) * 120, 3, 0.05, 0.008, ((voice * 0.017) % 0.25) + 0.01);
    },
    destroy() {
      enabled = false;
      ctx.close().catch(() => {});
    },
  };
}
