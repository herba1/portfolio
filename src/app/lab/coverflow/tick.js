export function createTicks() {
  let ctx = null;
  let noise = null;
  let out = null;
  let last = 0;

  const ensure = () => {
    if (ctx) return ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx({ latencyHint: "interactive" });
    const length = Math.floor(ctx.sampleRate * 0.05);
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let seed = 99173;
    for (let i = 0; i < length; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = ((seed / 4294967296) * 2 - 1) * (1 - i / length) ** 3;
    }
    out = ctx.createGain();
    out.gain.value = 0.5;
    out.connect(ctx.destination);
    return ctx;
  };

  const wake = () => {
    const c = ensure();
    if (c && c.state === "suspended") c.resume();
  };

  const tick = (speed = 0) => {
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    if (now - last < 0.028) return;
    last = now;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.9 + Math.min(speed, 12) * 0.03;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 3200;
    band.Q.value = 2.2;
    const env = ctx.createGain();
    const level = 0.09 / (1 + Math.min(speed, 12) * 0.08);
    env.gain.setValueAtTime(level, now);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.03);
    src.connect(band);
    band.connect(env);
    env.connect(out);
    src.start(now);
    src.stop(now + 0.05);
  };

  const flick = () => {
    if (!ctx || ctx.state !== "running") return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.32;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.setValueAtTime(900, now);
    band.frequency.exponentialRampToValueAtTime(2600, now + 0.12);
    band.Q.value = 0.9;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(0.07, now + 0.03);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
    src.connect(band);
    band.connect(env);
    env.connect(out);
    src.start(now);
    src.stop(now + 0.17);
  };

  const destroy = () => {
    ctx?.close();
    ctx = null;
  };

  return { wake, tick, flick, destroy };
}
