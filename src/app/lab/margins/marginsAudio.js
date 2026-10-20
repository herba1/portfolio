export function createPencilAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: "interactive" });
  const length = Math.floor(ctx.sampleRate * 2);
  const noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  let seed = 552211;
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const white = (seed / 4294967296) * 2 - 1;
    const grit = ((seed >>> 8) & 255) < 18 ? 2.2 : 1;
    data[i] = white * grit * 0.6;
  }
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 10;
  comp.ratio.value = 5;
  comp.attack.value = 0.002;
  comp.release.value = 0.12;
  master.connect(comp);
  comp.connect(ctx.destination);

  const scratch = ctx.createBufferSource();
  scratch.buffer = noise;
  scratch.loop = true;
  const band = ctx.createBiquadFilter();
  band.type = "bandpass";
  band.frequency.value = 3800;
  band.Q.value = 1.3;
  const body = ctx.createBiquadFilter();
  body.type = "peaking";
  body.frequency.value = 1500;
  body.Q.value = 1.2;
  body.gain.value = 3;
  const air = ctx.createBiquadFilter();
  air.type = "highshelf";
  air.frequency.value = 6000;
  air.gain.value = -4;
  const gain = ctx.createGain();
  gain.gain.value = 0;
  const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
  scratch.connect(band);
  band.connect(body);
  body.connect(air);
  air.connect(gain);
  gain.connect(panner);
  panner.connect(master);
  scratch.start();

  let enabled = true;
  let voice = 0;

  const burst = ({ type = "bandpass", freq, q = 1, peak, attack = 0.002, decay, pan = 0, rate = 1 }) => {
    const now = ctx.currentTime;
    voice = (voice + 1) % 97;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = rate;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(peak, now + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (p.pan) p.pan.value = Math.max(-0.8, Math.min(0.8, pan));
    src.connect(filter);
    filter.connect(env);
    env.connect(p);
    p.connect(master);
    src.start(now, ((voice * 0.0191) % 1.6) + 0.02, attack + decay + 0.05);
    src.onended = () => p.disconnect();
  };

  const live = () => enabled && ctx.state === "running";

  return {
    async wake() {
      if (enabled && ctx.state !== "running") await ctx.resume().catch(() => {});
    },
    async setEnabled(on) {
      enabled = on;
      if (on && ctx.state !== "running") await ctx.resume().catch(() => {});
      if (!on) gain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      return on && ctx.state === "running";
    },
    draw(level, angle, pan) {
      if (ctx.state !== "running") return;
      const now = ctx.currentTime;
      const target = enabled ? Math.min(0.5, level) * (0.75 + Math.random() * 0.5) : 0;
      gain.gain.setTargetAtTime(target, now, level > 0 ? 0.012 : 0.04);
      band.frequency.setTargetAtTime(3200 + Math.abs(Math.sin(angle)) * 1400 + Math.random() * 300, now, 0.03);
      if (panner.pan) panner.pan.setTargetAtTime(Math.max(-0.7, Math.min(0.7, pan)), now, 0.05);
    },
    touch(pan) {
      if (!live()) return;
      burst({ freq: 420 + (voice % 5) * 40, q: 2.2, peak: 0.1, attack: 0.002, decay: 0.025, pan });
      burst({ type: "highpass", freq: 4800, q: 0.7, peak: 0.06, attack: 0.001, decay: 0.01, pan });
    },
    rub(pan) {
      if (!live()) return;
      [0, 0.11, 0.2, 0.31].forEach((at, i) => {
        setTimeout(() => {
          if (live()) burst({ freq: 700 + i * 90, q: 0.9, peak: 0.16, attack: 0.03, decay: 0.07, pan: pan + (i % 2 ? 0.1 : -0.1), rate: 0.6 });
        }, at * 1000);
      });
    },
    destroy() {
      enabled = false;
      gain.disconnect();
      ctx.close().catch(() => {});
    },
  };
}
