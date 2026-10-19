export function createFoley() {
  let ctx = null;
  let noise = null;
  let last = 0;

  const ensure = () => {
    if (ctx) return ctx;
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    const length = Math.round(ctx.sampleRate * 0.6);
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let brown = 0;
    for (let i = 0; i < length; i += 1) {
      brown = brown * 0.86 + (Math.random() * 2 - 1) * 0.14;
      data[i] = brown * 3;
    }
    return ctx;
  };

  const burst = ({ duration, from, to, gain, q = 0.8 }) => {
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(gain, t + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(amp).connect(ctx.destination);
    src.start(t, Math.random() * 0.2, duration + 0.02);
  };

  return {
    unlock() {
      const c = ensure();
      if (c && c.state === "suspended") c.resume().catch(() => {});
    },
    flick(speed = 1) {
      const now = performance.now();
      if (now - last < 45) return;
      last = now;
      const s = Math.min(1, Math.max(0.3, speed));
      burst({ duration: 0.07, from: 2600, to: 900, gain: 0.05 * s, q: 1.1 });
    },
    slide(out) {
      burst({ duration: 0.36, from: out ? 700 : 1500, to: out ? 1600 : 600, gain: 0.035, q: 0.6 });
    },
    destroy() {
      ctx?.close().catch(() => {});
      ctx = null;
    },
  };
}
