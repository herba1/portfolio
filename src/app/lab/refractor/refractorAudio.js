export function createRefractorAudio() {
  let ctx = null;
  let noise = null;

  function start() {
    if (ctx) {
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      return;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    const length = Math.round(ctx.sampleRate * 0.12);
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / length, 3);
  }

  function snap(strength = 1) {
    if (!ctx || ctx.state !== "running") return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 0.9 + Math.random() * 0.25;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 2600 + Math.random() * 900;
    band.Q.value = 0.9;
    const gain = ctx.createGain();
    const level = 0.12 * Math.min(1, strength);
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(level, t + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.09);
    src.connect(band).connect(gain).connect(ctx.destination);
    src.start(t);
    src.stop(t + 0.12);
  }

  function destroy() {
    if (ctx) ctx.close().catch(() => {});
    ctx = null;
  }

  return { start, snap, destroy };
}
