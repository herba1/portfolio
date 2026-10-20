export function createMarqueeSound() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: "interactive" });
  const length = Math.floor(ctx.sampleRate * 1.2);
  const noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  let seed = 4417;
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 4294967296) * 2 - 1;
  }
  const master = ctx.createGain();
  master.gain.value = 0.8;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 10;
  comp.ratio.value = 4;
  comp.attack.value = 0.002;
  comp.release.value = 0.15;
  master.connect(comp);
  comp.connect(ctx.destination);

  let enabled = false;
  let voice = 0;
  let lastKey = 0;
  let hum = null;

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
    src.start(at, ((voice * 0.0173) % 1.0) + 0.01, attack + decay + 0.02);
    src.onended = () => out.disconnect();
  };

  const startHum = () => {
    if (hum) return;
    const now = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.006, now + 0.8);
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 900;
    lp.Q.value = 0.5;
    const base = ctx.createOscillator();
    base.type = "sine";
    base.frequency.value = 100;
    const buzz = ctx.createOscillator();
    buzz.type = "sawtooth";
    buzz.frequency.value = 100;
    const buzzGain = ctx.createGain();
    buzzGain.gain.value = 0.25;
    const whine = ctx.createOscillator();
    whine.type = "sine";
    whine.frequency.value = 3600;
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0;
    base.connect(lp);
    buzz.connect(buzzGain);
    buzzGain.connect(lp);
    lp.connect(g);
    whine.connect(whineGain);
    whineGain.connect(g);
    g.connect(master);
    base.start();
    buzz.start();
    whine.start();
    hum = { base, buzz, whine, whineGain, buzzGain, g };
  };

  const stopHum = () => {
    if (!hum) return;
    const { base, buzz, whine, g } = hum;
    hum = null;
    const now = ctx.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setTargetAtTime(0.0001, now, 0.06);
    base.stop(now + 0.4);
    buzz.stop(now + 0.4);
    whine.stop(now + 0.4);
  };

  const live = () => enabled && ctx.state === "running";

  return {
    async setEnabled(on) {
      enabled = on;
      if (on) {
        if (ctx.state !== "running") await ctx.resume().catch(() => {});
        if (ctx.state !== "running") return false;
        startHum();
        const now = ctx.currentTime;
        burst({ at: now, type: "lowpass", freq: 140, q: 0.9, gain: 0.35, attack: 0.003, decay: 0.12 });
        burst({ at: now + 0.004, freq: 3200, q: 1.4, gain: 0.08, attack: 0.0008, decay: 0.02, high: 1500 });
        return true;
      }
      stopHum();
      if (ctx.state === "running") await ctx.suspend().catch(() => {});
      return false;
    },
    load(fraction) {
      if (!hum || !live()) return;
      const now = ctx.currentTime;
      const f = Math.min(1, Math.max(0, fraction));
      hum.whineGain.gain.setTargetAtTime(0.0009 + f * 0.006, now, 0.04);
      hum.buzzGain.gain.setTargetAtTime(0.2 + f * 0.9, now, 0.05);
    },
    relay() {
      if (!live()) return;
      const now = ctx.currentTime;
      voice = (voice + 1) % 97;
      burst({ at: now, freq: 2600, q: 1.6, gain: 0.12, attack: 0.0006, decay: 0.012, high: 1200, pan: -0.15 });
      burst({ at: now + 0.001, freq: 420, q: 2.2, gain: 0.16, attack: 0.001, decay: 0.03, pan: -0.15 });
      burst({ at: now + 0.009, freq: 3400, q: 2, gain: 0.04, attack: 0.0005, decay: 0.008, high: 2000, pan: -0.15 });
    },
    key() {
      if (!live()) return;
      const now = ctx.currentTime;
      if (now - lastKey < 0.02) return;
      lastKey = now;
      voice = (voice + 1) % 97;
      const v = ((voice * 37) % 13) / 13;
      burst({ at: now, freq: 1800 + v * 900, q: 1.2, gain: 0.07, attack: 0.0008, decay: 0.016, high: 900 });
      burst({ at: now + 0.002, freq: 210 + v * 60, q: 2, gain: 0.12, attack: 0.002, decay: 0.04 });
    },
    destroy() {
      enabled = false;
      ctx.close().catch(() => {});
    },
  };
}
