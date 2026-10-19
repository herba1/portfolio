const MIN_GAP = 0.03;

export function createShutter() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: "interactive" });
  const length = Math.floor(ctx.sampleRate * 0.5);
  const noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  let seed = 918273;
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 4294967296) * 2 - 1;
  }
  const master = ctx.createGain();
  master.gain.value = 0.85;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 10;
  comp.ratio.value = 5;
  comp.attack.value = 0.002;
  comp.release.value = 0.1;
  master.connect(comp);
  comp.connect(ctx.destination);
  const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
  pan.connect(master);
  let enabled = true;
  let voice = 0;
  let last = 0;

  const burst = (at, freq, q, peak, decay, offset, type = "bandpass") => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = type;
    band.frequency.value = freq;
    band.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(peak, at + 0.0012);
    env.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    src.connect(band);
    band.connect(env);
    env.connect(pan);
    src.start(at, offset, decay + 0.02);
    src.onended = () => env.disconnect();
  };

  const thump = (at, freq, peak) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, at);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.55, at + 0.04);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(peak, at + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 0.05);
    osc.connect(env);
    env.connect(pan);
    osc.start(at);
    osc.stop(at + 0.06);
    osc.onended = () => env.disconnect();
  };

  return {
    get ctx() {
      return ctx;
    },
    async wake() {
      if (enabled && ctx.state !== "running") await ctx.resume().catch(() => {});
    },
    async setEnabled(on) {
      enabled = on;
      if (on && ctx.state !== "running") await ctx.resume().catch(() => {});
      if (!on && ctx.state === "running") await ctx.suspend().catch(() => {});
      return enabled && ctx.state === "running";
    },
    shutter(intensity = 1) {
      if (!enabled || ctx.state !== "running") return;
      const now = ctx.currentTime;
      if (now - last < MIN_GAP) return;
      last = now;
      voice = (voice + 1) % 89;
      const vary = ((voice * 37) % 17) / 17;
      const level = 0.55 + 0.45 * intensity;
      if (pan.pan) pan.pan.value = (vary - 0.5) * 0.24;
      const offset = ((voice * 0.0173) % 0.4) + 0.01;
      burst(now, 4200 + vary * 900, 1.1, 0.26 * level, 0.016, offset, "bandpass");
      burst(now, 1100 + vary * 160, 2.4, 0.16 * level, 0.03, offset + 0.03);
      thump(now, 150 + vary * 30, 0.12 * level);
      const second = now + 0.038 + vary * 0.012;
      burst(second, 3300 + vary * 600, 1.4, 0.13 * level, 0.014, offset + 0.06);
      burst(second, 820, 2.8, 0.08 * level, 0.026, offset + 0.09);
    },
    destroy() {
      enabled = false;
      ctx.close().catch(() => {});
    },
  };
}
