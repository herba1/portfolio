let ctx = null;
let noise = null;

export function wakeAudio() {
  if (typeof window === "undefined") return;
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    const length = Math.floor(ctx.sampleRate * 0.5);
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") ctx.resume();
}

const ready = () => ctx && ctx.state === "running";

export function pop() {
  if (!ready()) return;
  const t = ctx.currentTime;
  const osc = ctx.createOscillator();
  osc.type = "sine";
  osc.frequency.setValueAtTime(880, t);
  osc.frequency.exponentialRampToValueAtTime(1320, t + 0.06);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.05, t + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
  osc.connect(gain).connect(ctx.destination);
  osc.start(t);
  osc.stop(t + 0.16);
}

export function swish() {
  if (!ready()) return;
  const t = ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.Q.value = 1.1;
  band.frequency.setValueAtTime(2400, t);
  band.frequency.exponentialRampToValueAtTime(900, t + 0.22);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.04, t + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.24);
  src.connect(band).connect(gain).connect(ctx.destination);
  src.start(t);
  src.stop(t + 0.26);
}
