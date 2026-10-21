const TICK_GAP = 0.022;

export function createLensAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: "interactive" });
  const length = Math.floor(ctx.sampleRate * 2);
  const noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  let seed = 77001;
  let brown = 0;
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const white = (seed / 4294967296) * 2 - 1;
    brown = (brown + 0.04 * white) / 1.04;
    data[i] = white * 0.55 + brown * 3.2;
  }
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.12;
  master.connect(comp);
  comp.connect(ctx.destination);

  const bed = ctx.createBufferSource();
  bed.buffer = noise;
  bed.loop = true;
  const grease = ctx.createBiquadFilter();
  grease.type = "bandpass";
  grease.frequency.value = 520;
  grease.Q.value = 0.9;
  const air = ctx.createBiquadFilter();
  air.type = "lowpass";
  air.frequency.value = 2400;
  const bedGain = ctx.createGain();
  bedGain.gain.value = 0;
  bed.connect(grease);
  grease.connect(air);
  air.connect(bedGain);
  bedGain.connect(master);
  bed.start();

  let enabled = true;
  let last = 0;
  let voice = 0;

  const click = (freq, q, peak, decay) => {
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = freq;
    band.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(peak, now + 0.0008);
    env.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    src.connect(band);
    band.connect(env);
    env.connect(master);
    src.start(now, ((voice * 0.0191) % 1.6) + 0.02, decay + 0.02);
    src.onended = () => env.disconnect();
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
    friction(speed) {
      if (ctx.state !== "running") return;
      const s = Math.min(1, Math.abs(speed));
      const now = ctx.currentTime;
      bedGain.gain.setTargetAtTime(enabled ? s * 0.22 : 0, now, 0.04);
      grease.frequency.setTargetAtTime(420 + s * 520, now, 0.06);
    },
    detent(speed) {
      if (!enabled || ctx.state !== "running") return;
      const now = ctx.currentTime;
      if (now - last < TICK_GAP) return;
      last = now;
      voice = (voice + 1) % 53;
      const vary = ((voice * 31) % 11) / 11;
      const level = 0.05 + 0.05 * Math.min(1, Math.abs(speed));
      click(2900 + vary * 500, 3.5, level, 0.009);
      click(1150 + vary * 120, 5, level * 0.6, 0.016);
    },
    stop() {
      if (!enabled || ctx.state !== "running") return;
      voice = (voice + 1) % 53;
      click(240, 1.2, 0.3, 0.06);
      click(1700, 2.5, 0.08, 0.02);
    },
    destroy() {
      enabled = false;
      try {
        bed.stop();
      } catch {
        return ctx.close().catch(() => {});
      }
      return ctx.close().catch(() => {});
    },
  };
}
