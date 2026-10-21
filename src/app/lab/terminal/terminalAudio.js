export function createTerminalSound() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: "interactive" });
  const length = Math.floor(ctx.sampleRate * 1.2);
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
  let lastKey = 0;
  let hum = null;
  let raster = null;

  const burst = ({ at, type = "bandpass", freq, q = 1, gain, attack = 0.001, decay, offset, pan = 0, high = 0 }) => {
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
    src.start(at, offset ?? ((voice * 0.0173) % 1.0) + 0.01, attack + decay + 0.02);
    src.onended = () => out.disconnect();
  };

  const startHum = () => {
    if (hum) return;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 50;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 260;
    const whine = ctx.createOscillator();
    whine.frequency.value = 15734;
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0.0022;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.012, ctx.currentTime + 0.6);
    osc.connect(lp);
    lp.connect(g);
    whine.connect(whineGain);
    whineGain.connect(g);
    g.connect(master);
    osc.start();
    whine.start();
    hum = { osc, whine, g };
  };

  const stopHum = () => {
    if (!hum) return;
    const { osc, whine, g } = hum;
    hum = null;
    g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.05);
    osc.stop(ctx.currentTime + 0.3);
    whine.stop(ctx.currentTime + 0.3);
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
        burst({ at: now, type: "lowpass", freq: 120, q: 0.8, gain: 0.5, attack: 0.004, decay: 0.22 });
        burst({ at: now + 0.01, freq: 3400, q: 0.6, gain: 0.05, attack: 0.02, decay: 0.32, high: 1800 });
        return true;
      }
      stopHum();
      if (ctx.state === "running") await ctx.suspend().catch(() => {});
      return false;
    },
    key(soft = false) {
      if (!live()) return;
      const now = ctx.currentTime;
      if (now - lastKey < 0.018) return;
      lastKey = now;
      voice = (voice + 1) % 101;
      const v = ((voice * 37) % 17) / 17;
      const level = soft ? 0.5 : 1;
      const pan = (((voice * 13) % 9) / 9 - 0.5) * 0.5;
      burst({ at: now, freq: 2900 + v * 1400, q: 1.3, gain: 0.2 * level, attack: 0.0008, decay: 0.014, pan, high: 1200 });
      burst({ at: now + 0.002, freq: 190 + v * 90, q: 2.4, gain: 0.26 * level, attack: 0.002, decay: 0.045, pan });
      if (!soft) burst({ at: now + 0.028 + v * 0.01, freq: 1500 + v * 600, q: 2, gain: 0.05, attack: 0.001, decay: 0.012, pan });
    },
    tick() {
      if (!live()) return;
      const now = ctx.currentTime;
      voice = (voice + 1) % 101;
      burst({ at: now, freq: 4200, q: 1.8, gain: 0.09, attack: 0.0006, decay: 0.008, high: 2400 });
      burst({ at: now, freq: 640, q: 3, gain: 0.07, attack: 0.001, decay: 0.02 });
    },
    clunk() {
      if (!live()) return;
      const now = ctx.currentTime;
      voice = (voice + 1) % 101;
      burst({ at: now, type: "lowpass", freq: 160, q: 1.2, gain: 0.42, attack: 0.002, decay: 0.12 });
      burst({ at: now, freq: 2200, q: 1.4, gain: 0.16, attack: 0.0008, decay: 0.02, high: 900 });
      burst({ at: now + 0.05, freq: 900, q: 2.2, gain: 0.08, attack: 0.001, decay: 0.03 });
    },
    raster(on) {
      if (!live()) {
        if (raster) {
          raster.src.stop();
          raster = null;
        }
        return;
      }
      const now = ctx.currentTime;
      if (on && !raster) {
        const src = ctx.createBufferSource();
        src.buffer = noise;
        src.loop = true;
        const band = ctx.createBiquadFilter();
        band.type = "bandpass";
        band.frequency.value = 1100;
        band.Q.value = 6;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, now);
        g.gain.exponentialRampToValueAtTime(0.05, now + 0.06);
        band.frequency.setValueAtTime(900, now);
        band.frequency.exponentialRampToValueAtTime(2600, now + 1.3);
        src.connect(band);
        band.connect(g);
        g.connect(master);
        src.start(now);
        raster = { src, g };
      } else if (!on && raster) {
        const { src, g } = raster;
        raster = null;
        g.gain.setTargetAtTime(0.0001, now, 0.03);
        src.stop(now + 0.2);
      }
    },
    destroy() {
      enabled = false;
      ctx.close().catch(() => {});
    },
  };
}
