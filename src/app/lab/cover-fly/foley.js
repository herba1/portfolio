let ctx = null;
let noise = null;

export function wakeAudio() {
  if (typeof window === "undefined") return;
  if (!ctx) {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    ctx = new Ctor();
    const length = Math.floor(ctx.sampleRate * 0.6);
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === "suspended") ctx.resume();
}

function burst({ type, from, to, q, peak, attack, release, at = 0 }) {
  const t = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noise;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(from, t);
  filter.frequency.exponentialRampToValueAtTime(to, t + attack + release);
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(peak, t + attack);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + attack + release);
  src.connect(filter).connect(gain).connect(ctx.destination);
  src.start(t);
  src.stop(t + attack + release + 0.05);
}

export function toss() {
  if (!ctx || ctx.state !== "running") return;
  burst({ type: "bandpass", from: 700, to: 2400, q: 1.2, peak: 0.035, attack: 0.08, release: 0.3 });
}

export function clack() {
  if (!ctx || ctx.state !== "running") return;
  burst({ type: "highpass", from: 2600, to: 2200, q: 0.7, peak: 0.09, attack: 0.002, release: 0.04 });
  burst({ type: "lowpass", from: 420, to: 160, q: 1, peak: 0.12, attack: 0.003, release: 0.09 });
  burst({ type: "highpass", from: 3200, to: 3000, q: 0.7, peak: 0.04, attack: 0.002, release: 0.03, at: 0.055 });
}
