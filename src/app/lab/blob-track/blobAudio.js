export function createBlips() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: "interactive" });
  const length = Math.floor(ctx.sampleRate * 0.25);
  const noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  let seed = 7331;
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 4294967296) * 2 - 1;
  }
  const master = ctx.createGain();
  master.gain.value = 0.8;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 10;
  comp.ratio.value = 5;
  comp.attack.value = 0.002;
  comp.release.value = 0.1;
  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 6200;
  master.connect(tone);
  tone.connect(comp);
  comp.connect(ctx.destination);
  let enabled = false;
  let last = 0;
  let voice = 0;

  const out = (pan) => {
    if (!ctx.createStereoPanner) return master;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-0.8, Math.min(0.8, pan));
    p.connect(master);
    return p;
  };

  const pip = (freq, level, dur, pan) => {
    const now = ctx.currentTime;
    const dest = out(pan);
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq, now);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.94, now + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(level, now + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(env);
    env.connect(dest);
    osc.start(now);
    osc.stop(now + dur + 0.02);
    osc.onended = () => {
      env.disconnect();
      if (dest !== master) dest.disconnect();
    };
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 3800 + ((voice * 53) % 17) * 90;
    band.Q.value = 2.2;
    const nenv = ctx.createGain();
    nenv.gain.setValueAtTime(0.0001, now);
    nenv.gain.exponentialRampToValueAtTime(level * 0.9, now + 0.0008);
    nenv.gain.exponentialRampToValueAtTime(0.0001, now + 0.012);
    src.connect(band);
    band.connect(nenv);
    nenv.connect(dest);
    src.start(now, ((voice * 0.031) % 0.2) + 0.01, 0.02);
    src.onended = () => nenv.disconnect();
  };

  return {
    async setEnabled(on) {
      enabled = on;
      if (on && ctx.state !== "running") await ctx.resume().catch(() => {});
      if (!on && ctx.state === "running") await ctx.suspend().catch(() => {});
      return enabled && ctx.state === "running";
    },
    acquire(size, pan) {
      if (!enabled || ctx.state !== "running") return;
      const now = ctx.currentTime;
      if (now - last < 0.045) return;
      last = now;
      voice = (voice + 1) % 101;
      const freq = 3400 - Math.min(1, size) * 1500 + ((voice * 37) % 7) * 40;
      pip(freq, 0.07, 0.03, pan);
    },
    lose(pan) {
      if (!enabled || ctx.state !== "running") return;
      const now = ctx.currentTime;
      if (now - last < 0.06) return;
      last = now;
      voice = (voice + 1) % 101;
      pip(1250 + ((voice * 29) % 5) * 30, 0.035, 0.022, pan);
    },
    destroy() {
      enabled = false;
      ctx.close().catch(() => {});
    },
  };
}
