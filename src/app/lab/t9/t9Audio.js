export function createT9Sound() {
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
    key(index = 0) {
      if (!live()) return;
      const now = ctx.currentTime;
      if (now - lastTick < 0.02) return;
      lastTick = now;
      const v = ((index * 37) % 11) / 11;
      const pan = (((index * 13) % 9) / 9 - 0.5) * 0.3;
      burst({ at: now, freq: 2400 + v * 900, q: 1.6, gain: 0.13, attack: 0.0008, decay: 0.012, pan, high: 1100 });
      burst({ at: now + 0.001, freq: 330 + v * 120, q: 2.4, gain: 0.16, attack: 0.0015, decay: 0.026, pan });
      burst({ at: now + 0.034, freq: 1700 + v * 500, q: 2.2, gain: 0.04, attack: 0.0008, decay: 0.01, pan });
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = 1320;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 2600;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.012, now + 0.003);
      g.gain.setValueAtTime(0.012, now + 0.04);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
      osc.connect(lp);
      lp.connect(g);
      g.connect(master);
      osc.start(now);
      osc.stop(now + 0.07);
      osc.onended = () => g.disconnect();
    },
    sent() {
      if (!live()) return;
      const now = ctx.currentTime;
      [1046.5, 1568].forEach((f, i) => {
        const at = now + i * 0.09;
        const osc = ctx.createOscillator();
        osc.type = "triangle";
        osc.frequency.value = f;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, at);
        g.gain.exponentialRampToValueAtTime(0.05, at + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
        osc.connect(g);
        g.connect(master);
        osc.start(at);
        osc.stop(at + 0.2);
        osc.onended = () => g.disconnect();
      });
    },
    destroy() {
      enabled = false;
      ctx.close().catch(() => {});
    },
  };
}
