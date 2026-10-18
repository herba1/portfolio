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

export function whoosh(up) {
  if (!ctx || ctx.state !== "running") return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 1.4;
  band.frequency.setValueAtTime(up ? 500 : 1800, t);
  band.frequency.exponentialRampToValueAtTime(up ? 2200 : 420, t + 0.42);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.05, t + 0.12);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
  src.connect(band).connect(gain).connect(ctx.destination);
  src.start(t);
  src.stop(t + 0.55);
}

export function closeAudio() {
  ctx?.close();
  ctx = null;
  noise = null;
}
