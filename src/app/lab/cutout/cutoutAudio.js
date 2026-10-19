export function createPaperAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: "interactive" });
  const length = Math.floor(ctx.sampleRate * 1.2);
  const noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  let seed = 918273;
  let brown = 0;
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const white = (seed / 4294967296) * 2 - 1;
    brown = brown * 0.6 + white * 0.4;
    data[i] = white * 0.7 + brown * 0.5;
  }
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 10;
  comp.ratio.value = 5;
  comp.attack.value = 0.002;
  comp.release.value = 0.14;
  master.connect(comp);
  comp.connect(ctx.destination);

  const slideSrc = ctx.createBufferSource();
  slideSrc.buffer = noise;
  slideSrc.loop = true;
  const slideBand = ctx.createBiquadFilter();
  slideBand.type = "bandpass";
  slideBand.frequency.value = 2200;
  slideBand.Q.value = 0.6;
  const slideHigh = ctx.createBiquadFilter();
  slideHigh.type = "highshelf";
  slideHigh.frequency.value = 5000;
  slideHigh.gain.value = -6;
  const slideGain = ctx.createGain();
  slideGain.gain.value = 0;
  const slidePan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
  slideSrc.connect(slideBand);
  slideBand.connect(slideHigh);
  slideHigh.connect(slideGain);
  slideGain.connect(slidePan);
  slidePan.connect(master);
  slideSrc.start();

  let enabled = true;
  let voice = 0;
  let lastTick = 0;

  const burst = ({ at = 0, type = "bandpass", freq, q = 1, peak, attack = 0.002, decay, pan = 0, rate = 1 }) => {
    const now = ctx.currentTime + at;
    voice = (voice + 1) % 101;
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
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (panner.pan) panner.pan.value = Math.max(-0.8, Math.min(0.8, pan));
    src.connect(filter);
    filter.connect(env);
    env.connect(panner);
    panner.connect(master);
    src.start(now, ((voice * 0.0173) % 1.0) + 0.02, attack + decay + 0.05);
    src.onended = () => panner.disconnect();
  };

  const live = () => enabled && ctx.state === "running";

  return {
    async wake() {
      if (enabled && ctx.state !== "running") await ctx.resume().catch(() => {});
    },
    async setEnabled(on) {
      enabled = on;
      if (on && ctx.state !== "running") await ctx.resume().catch(() => {});
      if (!on) slideGain.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      return on && ctx.state === "running";
    },
    lift(pan) {
      if (!live()) return;
      const v = (voice % 5) / 5;
      burst({ type: "highpass", freq: 2600 + v * 900, q: 0.7, peak: 0.16, attack: 0.018, decay: 0.09, pan });
      burst({ freq: 340 + v * 60, q: 1.4, peak: 0.08, attack: 0.006, decay: 0.05, pan });
    },
    land(strength, pan) {
      if (!live()) return;
      const s = Math.max(0.35, Math.min(1, strength));
      const v = (voice % 7) / 7;
      burst({ type: "lowpass", freq: 900 + v * 200, q: 0.9, peak: 0.42 * s, attack: 0.0015, decay: 0.05, pan, rate: 0.8 });
      burst({ freq: 210 + v * 40, q: 2.4, peak: 0.3 * s, attack: 0.002, decay: 0.07, pan });
      burst({ type: "highpass", freq: 5200, q: 0.7, peak: 0.07 * s, attack: 0.001, decay: 0.012, pan });
    },
    snip(pan) {
      if (!live()) return;
      burst({ type: "highpass", freq: 3200, q: 0.6, peak: 0.08, attack: 0.012, decay: 0.05, pan });
      burst({ at: 0.05, freq: 4300, q: 9, peak: 0.26, attack: 0.001, decay: 0.03, pan });
      burst({ at: 0.052, freq: 7100, q: 7, peak: 0.12, attack: 0.001, decay: 0.022, pan });
      burst({ at: 0.06, freq: 1200, q: 1.5, peak: 0.12, attack: 0.002, decay: 0.03, pan });
    },
    key(pan) {
      if (!live()) return;
      const now = ctx.currentTime;
      if (now - lastTick < 0.025) return;
      lastTick = now;
      const v = (voice % 6) / 6;
      burst({ freq: 2600 + v * 700, q: 2.2, peak: 0.09, attack: 0.001, decay: 0.018, pan });
      burst({ freq: 480 + v * 80, q: 2, peak: 0.05, attack: 0.002, decay: 0.024, pan });
    },
    slide(speed, pan) {
      if (ctx.state !== "running") return;
      const level = enabled ? Math.min(0.11, speed * 0.00011) : 0;
      slideGain.gain.setTargetAtTime(level, ctx.currentTime, 0.04);
      slideBand.frequency.setTargetAtTime(1600 + Math.min(1800, speed * 1.4), ctx.currentTime, 0.06);
      if (slidePan.pan) slidePan.pan.setTargetAtTime(Math.max(-0.7, Math.min(0.7, pan)), ctx.currentTime, 0.05);
    },
    destroy() {
      enabled = false;
      slideGain.disconnect();
      ctx.close().catch(() => {});
    },
  };
}
