export function createAudio() {
  let ctx = null;
  let noise = null;
  let out = null;
  let band = null;
  let air = null;
  let pan = null;
  let enabled = true;
  let voice = 0;
  let lastTick = 0;

  const ensure = () => {
    if (ctx) return ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx({ latencyHint: "interactive" });
    const length = Math.floor(ctx.sampleRate * 2);
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let seed = 424242;
    let brown = 0;
    for (let i = 0; i < length; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const white = (seed / 4294967296) * 2 - 1;
      brown = brown * 0.86 + white * 0.14;
      data[i] = white * 0.55 + brown * 1.6;
    }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.12;
    out = ctx.createGain();
    out.gain.value = 0.8;
    out.connect(comp);
    comp.connect(ctx.destination);

    const loop = ctx.createBufferSource();
    loop.buffer = noise;
    loop.loop = true;
    band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 900;
    band.Q.value = 0.9;
    const high = ctx.createBiquadFilter();
    high.type = "highpass";
    high.frequency.value = 260;
    air = ctx.createGain();
    air.gain.value = 0;
    loop.connect(band);
    band.connect(high);
    high.connect(air);
    if (ctx.createStereoPanner) {
      pan = ctx.createStereoPanner();
      air.connect(pan);
      pan.connect(out);
    } else {
      air.connect(out);
    }
    loop.start();
    return ctx;
  };

  const live = () => enabled && ctx && ctx.state === "running";

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
    motion(energy, x) {
      if (!live()) return;
      const now = ctx.currentTime;
      const e = Math.min(1, energy);
      air.gain.setTargetAtTime(e * e * 0.34, now, 0.05);
      band.frequency.setTargetAtTime(500 + e * 2600, now, 0.06);
      if (pan) pan.pan.setTargetAtTime(Math.max(-0.7, Math.min(0.7, x)), now, 0.08);
    },
    land(x, line) {
      if (!live()) return;
      const now = ctx.currentTime;
      if (now - lastTick < 0.024) return;
      lastTick = now;
      voice = (voice + 1) % 61;
      const vary = ((voice * 29) % 13) / 13;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 2600 + vary * 1400 - line * 40;
      f.Q.value = 2.2;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, now);
      env.gain.exponentialRampToValueAtTime(0.07, now + 0.001);
      env.gain.exponentialRampToValueAtTime(0.0001, now + 0.022);
      src.connect(f);
      f.connect(env);
      if (ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = Math.max(-0.7, Math.min(0.7, x));
        env.connect(p);
        p.connect(out);
      } else {
        env.connect(out);
      }
      src.start(now, (voice * 0.0173) % 1.8, 0.04);
      src.onended = () => env.disconnect();
    },
    quiet() {
      if (!ctx || !air) return;
      air.gain.setTargetAtTime(0, ctx.currentTime, 0.06);
    },
    destroy() {
      enabled = false;
      if (ctx) ctx.close().catch(() => {});
      ctx = null;
    },
  };
}
