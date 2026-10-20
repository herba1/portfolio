export function createRustle() {
  let ctx = null;
  let master = null;
  let bed = null;
  let bedGain = null;
  let noise = null;
  let lastCrackle = 0;

  function unlock() {
    if (ctx) {
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      return;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = 0.5;
    master.connect(ctx.destination);
    const len = Math.floor(ctx.sampleRate * 2);
    noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < len; i += 1) {
      const white = Math.random() * 2 - 1;
      brown = (brown + 0.08 * white) / 1.08;
      data[i] = white * 0.6 + brown * 2.4;
    }
    bed = ctx.createBufferSource();
    bed.buffer = noise;
    bed.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 3400;
    band.Q.value = 0.6;
    const high = ctx.createBiquadFilter();
    high.type = "highpass";
    high.frequency.value = 1100;
    bedGain = ctx.createGain();
    bedGain.gain.value = 0;
    bed.connect(band).connect(high).connect(bedGain).connect(master);
    bed.start();
  }

  function burst(at, dur, freq, q, gain) {
    if (!ctx) return;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = freq;
    filter.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter).connect(env).connect(master);
    src.start(t, Math.random() * 1.5, dur + 0.05);
  }

  return {
    unlock,
    motion(speed) {
      if (!ctx || !bedGain) return;
      const level = Math.min(0.11, speed * 0.02);
      bedGain.gain.setTargetAtTime(level, ctx.currentTime, 0.05);
      const now = ctx.currentTime;
      if (speed > 1.6 && now - lastCrackle > 0.05 + Math.random() * 0.12) {
        lastCrackle = now;
        burst(0, 0.018, 4200 + Math.random() * 2600, 2.4, 0.05 * Math.min(1, speed / 5));
      }
    },
    land(strength = 1) {
      burst(0, 0.09, 520, 0.8, 0.18 * strength);
      burst(0.01, 0.05, 2600, 1.2, 0.05 * strength);
    },
    crease() {
      burst(0, 0.03, 3600, 1.8, 0.07);
    },
    close() {
      try {
        bed?.stop();
      } catch {}
      ctx?.close().catch(() => {});
      ctx = null;
    },
  };
}
