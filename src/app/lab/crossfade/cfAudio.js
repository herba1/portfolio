export function createClicks() {
  let ctx = null;
  const ensure = () => {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === "suspended") ctx.resume();
    return ctx;
  };
  const click = (pitch = 1, level = 0.06) => {
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime;
    const length = Math.floor(ctx.sampleRate * 0.03);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (length * 0.12));
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 2400 * pitch;
    band.Q.value = 3;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(level, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    src.connect(band).connect(gain).connect(ctx.destination);
    src.start(t);
    src.stop(t + 0.06);
  };
  return {
    wake: ensure,
    click,
    destroy() {
      ctx?.close();
      ctx = null;
    },
  };
}
