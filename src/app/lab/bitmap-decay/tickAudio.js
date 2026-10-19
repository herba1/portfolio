const MIN_GAP = 0.034;

export function createTicks() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: "interactive" });
  const length = Math.floor(ctx.sampleRate * 0.3);
  const noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  let seed = 424242;
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 4294967296) * 2 - 1;
  }
  const master = ctx.createGain();
  master.gain.value = 0.8;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.ratio.value = 4;
  comp.attack.value = 0.002;
  comp.release.value = 0.08;
  master.connect(comp);
  comp.connect(ctx.destination);
  let enabled = true;
  let voice = 0;
  let last = 0;

  const tick = (kind, pan, amount) => {
    const now = ctx.currentTime;
    if (now - last < MIN_GAP) return;
    last = now;
    voice = (voice + 1) % 61;
    const vary = ((voice * 29) % 13) / 13;
    const level = Math.min(1, 0.45 + 0.18 * Math.log2(1 + amount));
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (panner.pan) panner.pan.value = Math.max(-0.8, Math.min(0.8, pan));
    panner.connect(master);
    const pitch = kind === "heal" ? 2350 : 1480;
    const osc = ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(pitch * (1 + vary * 0.04), now);
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 3800;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(0.028 * level, now + 0.001);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.018);
    osc.connect(tone);
    tone.connect(env);
    env.connect(panner);
    osc.start(now);
    osc.stop(now + 0.03);
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 5200 + vary * 1400;
    band.Q.value = 1.4;
    const nenv = ctx.createGain();
    nenv.gain.setValueAtTime(0.0001, now);
    nenv.gain.exponentialRampToValueAtTime(0.09 * level, now + 0.0006);
    nenv.gain.exponentialRampToValueAtTime(0.0001, now + 0.009);
    src.connect(band);
    band.connect(nenv);
    nenv.connect(panner);
    src.start(now, ((voice * 0.0113) % 0.25) + 0.01, 0.02);
    src.onended = () => {
      nenv.disconnect();
      env.disconnect();
      panner.disconnect();
    };
  };

  return {
    async wake() {
      if (enabled && ctx.state !== "running") await ctx.resume().catch(() => {});
    },
    async setEnabled(on) {
      enabled = on;
      if (on && ctx.state !== "running") await ctx.resume().catch(() => {});
      if (!on && ctx.state === "running") await ctx.suspend().catch(() => {});
      return enabled && ctx.state === "running";
    },
    tick(kind, pan = 0, amount = 1) {
      if (!enabled || ctx.state !== "running") return;
      tick(kind, pan, amount);
    },
    destroy() {
      enabled = false;
      ctx.close().catch(() => {});
    },
  };
}
