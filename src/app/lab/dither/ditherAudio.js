export function createDitherSound() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: "interactive" });
  const length = Math.floor(ctx.sampleRate * 1);
  const noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  let seed = 4242;
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
  comp.release.value = 0.12;
  master.connect(comp);
  comp.connect(ctx.destination);

  let enabled = false;
  let voice = 0;
  let lastTick = 0;

  const burst = ({ at, type = "bandpass", freq, q = 1, gain, attack = 0.001, decay, pan = 0, high = 0 }) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    let tail = filter;
    if (high) {
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = high;
      filter.connect(hp);
      tail = hp;
    }
    src.connect(filter);
    tail.connect(env);
    let out = env;
    if (ctx.createStereoPanner && pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      env.connect(p);
      out = p;
    }
    out.connect(master);
    voice = (voice + 1) % 97;
    src.start(at, ((voice * 0.0173) % 0.9) + 0.01, attack + decay + 0.02);
    src.onended = () => out.disconnect();
  };

  const live = () => enabled && ctx.state === "running";

  return {
    async setEnabled(on) {
      enabled = on;
      if (on) {
        if (ctx.state !== "running") await ctx.resume().catch(() => {});
        return ctx.state === "running";
      }
      if (ctx.state === "running") await ctx.suspend().catch(() => {});
      return false;
    },
    press(pan = 0) {
      if (!live()) return;
      const now = ctx.currentTime;
      burst({ at: now, freq: 3200, q: 1.4, gain: 0.16, attack: 0.0008, decay: 0.012, pan, high: 1500 });
      burst({ at: now + 0.001, freq: 420, q: 2.2, gain: 0.2, attack: 0.0015, decay: 0.03, pan });
    },
    release(pan = 0) {
      if (!live()) return;
      const now = ctx.currentTime;
      burst({ at: now, freq: 4200, q: 1.6, gain: 0.08, attack: 0.0006, decay: 0.008, pan, high: 2200 });
      burst({ at: now, freq: 620, q: 2.6, gain: 0.08, attack: 0.001, decay: 0.018, pan });
    },
    tick(pan = 0) {
      if (!live()) return;
      const now = ctx.currentTime;
      if (now - lastTick < 0.025) return;
      lastTick = now;
      burst({ at: now, freq: 2600, q: 3, gain: 0.07, attack: 0.0006, decay: 0.01, pan, high: 1200 });
    },
    swap() {
      if (!live()) return;
      const now = ctx.currentTime;
      burst({ at: now, type: "lowpass", freq: 180, q: 1, gain: 0.22, attack: 0.003, decay: 0.08 });
      burst({ at: now + 0.02, freq: 1800, q: 0.7, gain: 0.035, attack: 0.08, decay: 0.32, high: 900 });
    },
    destroy() {
      enabled = false;
      ctx.close().catch(() => {});
    },
  };
}
