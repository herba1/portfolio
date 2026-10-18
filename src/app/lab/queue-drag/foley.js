export function createFoley() {
  let ctx = null;
  let noise = null;
  let last = 0;

  const ensure = () => {
    if (ctx) return ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx({ latencyHint: "interactive" });
    const length = Math.floor(ctx.sampleRate * 0.4);
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let seed = 4021;
    for (let i = 0; i < length; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 4294967296) * 2 - 1;
    }
    return ctx;
  };

  const wake = () => {
    const c = ensure();
    if (c && c.state === "suspended") c.resume();
  };

  const burst = ({ freq, q, gain, dur, sweep = 0 }) => {
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.setValueAtTime(freq, now);
    if (sweep) band.frequency.exponentialRampToValueAtTime(freq * sweep, now + dur);
    band.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(gain, now + Math.min(0.004, dur / 4));
    env.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    src.connect(band);
    band.connect(env);
    env.connect(ctx.destination);
    src.start(now, Math.random() * 0.3);
    src.stop(now + dur + 0.02);
  };

  return {
    wake,
    tick() {
      if (!ctx) return;
      const now = ctx.currentTime;
      if (now - last < 0.04) return;
      last = now;
      burst({ freq: 2400, q: 3, gain: 0.07, dur: 0.025 });
    },
    lift() {
      burst({ freq: 900, q: 1.2, gain: 0.05, dur: 0.06 });
    },
    swish() {
      burst({ freq: 1800, q: 0.8, gain: 0.06, dur: 0.22, sweep: 0.35 });
    },
    destroy() {
      ctx?.close();
      ctx = null;
    },
  };
}
