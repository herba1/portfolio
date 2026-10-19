let ctx = null;
let noise = null;

export function wakeAudio() {
  if (typeof window === "undefined") return;
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    const length = ctx.sampleRate;
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") ctx.resume();
}

export function flick() {
  if (!ctx || ctx.state !== "running") return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 0.9;
  band.frequency.setValueAtTime(900, t);
  band.frequency.exponentialRampToValueAtTime(3400, t + 0.42);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.03, t + 0.06);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
  src.connect(band).connect(gain).connect(ctx.destination);
  src.start(t);
  src.stop(t + 0.55);
}

export function closeAudio() {
  ctx?.close();
  ctx = null;
  noise = null;
}
