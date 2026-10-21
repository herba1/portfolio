export function createAudio() {
  let ctx = null;
  let noise = null;
  let out = null;
  let enabled = true;
  let voice = 0;
  let lastTick = 0;
  let lastKey = 0;

  const ensure = () => {
    if (ctx) return ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx({ latencyHint: "interactive" });
    const length = Math.floor(ctx.sampleRate * 0.5);
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let seed = 99173;
    for (let i = 0; i < length; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 4294967296) * 2 - 1;
    }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 10;
    comp.ratio.value = 5;
    comp.attack.value = 0.002;
    comp.release.value = 0.1;
    out = ctx.createGain();
    out.gain.value = 0.85;
    out.connect(comp);
    comp.connect(ctx.destination);
    return ctx;
  };

  const live = () => enabled && ctx && ctx.state === "running";

  const burst = (now, { pan = 0, freq, q, gain, decay, offset, type = "bandpass", high = 0 }) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = type;
    band.frequency.value = freq;
    band.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(gain, now + 0.001);
    env.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    src.connect(band);
    let tail = band;
    if (high) {
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = high;
      band.connect(hp);
      tail = hp;
    }
    tail.connect(env);
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-0.8, Math.min(0.8, pan));
      env.connect(p);
      p.connect(out);
    } else {
      env.connect(out);
    }
    src.start(now, offset, decay + 0.02);
    src.onended = () => env.disconnect();
  };

  const tone = (now, { freq, gain, decay, pan = 0 }) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(freq * 1.6, now);
    osc.frequency.exponentialRampToValueAtTime(freq, now + 0.012);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(gain, now + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    osc.connect(env);
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-0.8, Math.min(0.8, pan));
      env.connect(p);
      p.connect(out);
    } else {
      env.connect(out);
    }
    osc.start(now);
    osc.stop(now + decay + 0.02);
    osc.onended = () => env.disconnect();
  };

  return {
    unlock() {
      if (!enabled) return;
      const c = ensure();
      if (c && c.state !== "running") c.resume().catch(() => {});
    },
    async setEnabled(on) {
      enabled = on;
      const c = on ? ensure() : ctx;
      if (!c) return false;
      if (on && c.state !== "running") await c.resume().catch(() => {});
      if (!on && c.state === "running") await c.suspend().catch(() => {});
      return on;
    },
    tick(pan, line) {
      if (!live()) return;
      const now = ctx.currentTime;
      if (now - lastTick < 0.03) return;
      lastTick = now;
      voice = (voice + 1) % 89;
      const vary = ((voice * 37) % 23) / 23;
      burst(now, { pan, freq: 2100 + vary * 900 - line * 60, q: 2.4, gain: 0.09, decay: 0.026, offset: (voice * 0.0113) % 0.4, high: 700 });
      tone(now, { freq: 420 - line * 18 + vary * 40, gain: 0.05, decay: 0.05, pan });
    },
    key(pan) {
      if (!live()) return;
      const now = ctx.currentTime;
      if (now - lastKey < 0.02) return;
      lastKey = now;
      voice = (voice + 1) % 89;
      const vary = ((voice * 53) % 17) / 17;
      burst(now, { pan, freq: 3200 + vary * 1200, q: 1.4, gain: 0.12, decay: 0.018, offset: (voice * 0.0171) % 0.4, high: 1200 });
      burst(now + 0.004, { pan, freq: 240 + vary * 60, q: 3, gain: 0.16, decay: 0.05, offset: (voice * 0.0091) % 0.4 });
    },
    detent(level) {
      if (!live()) return;
      const now = ctx.currentTime;
      burst(now, { freq: 3800 + level * 1600, q: 3, gain: 0.05, decay: 0.012, offset: (level * 0.31) % 0.4, high: 1500 });
    },
    destroy() {
      enabled = false;
      if (ctx) ctx.close().catch(() => {});
      ctx = null;
    },
  };
}
