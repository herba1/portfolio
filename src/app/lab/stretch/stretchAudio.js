export function createStretchSound() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: "interactive" });
  const length = Math.floor(ctx.sampleRate * 0.6);
  const noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  let seed = 90210;
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 4294967296) * 2 - 1;
  }
  const master = ctx.createGain();
  master.gain.value = 0.85;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 10;
  comp.ratio.value = 5;
  comp.attack.value = 0.002;
  comp.release.value = 0.14;
  master.connect(comp);
  comp.connect(ctx.destination);

  let enabled = false;
  let voice = 0;
  let lastTick = 0;

  const pan = (x) => {
    const node = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (node.pan) node.pan.value = Math.max(-0.8, Math.min(0.8, x));
    node.connect(master);
    return node;
  };

  const burst = (out, { freq, q = 2, type = "bandpass", peak, attack = 0.001, decay, at = 0 }) => {
    const now = ctx.currentTime + at;
    voice = (voice + 1) % 101;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), now + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
    src.connect(filter);
    filter.connect(env);
    env.connect(out);
    const offset = ((voice * 0.0173) % 0.5) + 0.01;
    src.start(now, offset, attack + decay + 0.02);
    src.onended = () => {
      env.disconnect();
      out.disconnect();
    };
  };

  const ready = () => enabled && ctx.state === "running";

  return {
    async setEnabled(on) {
      enabled = on;
      if (on && ctx.state !== "running") await ctx.resume().catch(() => {});
      if (!on && ctx.state === "running") await ctx.suspend().catch(() => {});
      return enabled && ctx.state === "running";
    },
    grab(x) {
      if (!ready()) return;
      burst(pan(x), { freq: 2400, q: 1.4, peak: 0.16, decay: 0.014 });
      burst(pan(x), { freq: 210, q: 2.6, peak: 0.2, attack: 0.002, decay: 0.05 });
    },
    tick(x, tension, level) {
      if (!ready()) return;
      const now = ctx.currentTime;
      if (now - lastTick < 0.018) return;
      lastTick = now;
      const jitter = ((voice * 37) % 13) / 13;
      const freq = Math.min(5200, 900 + tension * 3600 + jitter * 260);
      burst(pan(x), { freq, q: 5 + tension * 6, peak: 0.07 * level, decay: 0.008 + (1 - tension) * 0.008 });
    },
    settle(x, level) {
      if (!ready()) return;
      burst(pan(x), { freq: 150, q: 1.2, type: "lowpass", peak: 0.34 * level, attack: 0.003, decay: 0.09 });
      burst(pan(x), { freq: 1700, q: 1.8, peak: 0.06 * level, decay: 0.02 });
    },
    key(x) {
      if (!ready()) return;
      burst(pan(x), { freq: 3100 + ((voice * 53) % 7) * 120, q: 1.6, peak: 0.08, decay: 0.012 });
      burst(pan(x), { freq: 420, q: 2.4, peak: 0.07, attack: 0.002, decay: 0.03 });
    },
    destroy() {
      enabled = false;
      ctx.close().catch(() => {});
    },
  };
}
