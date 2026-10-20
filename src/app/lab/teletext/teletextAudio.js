export function createTeletextSound() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: "interactive" });
  const length = Math.floor(ctx.sampleRate * 2);
  const noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  let seed = 1984;
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 4294967296) * 2 - 1;
  }
  const master = ctx.createGain();
  master.gain.value = 0.85;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -22;
  comp.knee.value = 10;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  master.connect(comp);
  comp.connect(ctx.destination);

  let enabled = false;
  let voice = 0;
  let bed = null;

  const startBed = () => {
    if (bed) return;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1800;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 7000;
    const g = ctx.createGain();
    g.gain.value = 0.0001;
    src.connect(hp);
    hp.connect(lp);
    lp.connect(g);
    g.connect(master);
    src.start();
    bed = { src, g, lp };
  };

  const stopBed = () => {
    if (!bed) return;
    const { src, g } = bed;
    bed = null;
    const now = ctx.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setTargetAtTime(0.0001, now, 0.04);
    src.stop(now + 0.3);
  };

  const burst = ({ at, freq, q = 1, gain, attack = 0.001, decay, high = 0 }) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = freq;
    filter.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    let tail = filter;
    if (high) {
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = high;
      filter.connect(hp);
      tail = hp;
    }
    src.connect(filter);
    tail.connect(env);
    env.connect(master);
    src.start(at, ((voice * 0.0173) % 1.5) + 0.01, attack + decay + 0.02);
    src.onended = () => env.disconnect();
  };

  const live = () => enabled && ctx.state === "running";

  return {
    async setEnabled(on) {
      enabled = on;
      if (on) {
        if (ctx.state !== "running") await ctx.resume().catch(() => {});
        if (ctx.state !== "running") return false;
        startBed();
        return true;
      }
      stopBed();
      if (ctx.state === "running") window.setTimeout(() => !enabled && ctx.suspend().catch(() => {}), 300);
      return false;
    },
    searching(on) {
      if (!bed || !live()) return;
      const now = ctx.currentTime;
      bed.g.gain.cancelScheduledValues(now);
      bed.g.gain.setTargetAtTime(on ? 0.006 : 0.0001, now, on ? 0.08 : 0.12);
    },
    arrive(rows, step) {
      if (!bed || !live()) return;
      const now = ctx.currentTime;
      const dur = rows * step;
      const g = bed.g.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(Math.max(0.0001, g.value), now);
      g.exponentialRampToValueAtTime(0.03, now + 0.03);
      g.setValueAtTime(0.03, now + dur);
      g.exponentialRampToValueAtTime(0.0001, now + dur + 0.22);
      bed.lp.frequency.setValueAtTime(5200, now);
      bed.lp.frequency.linearRampToValueAtTime(7600, now + dur);
      for (let i = 0; i < rows; i += 1) {
        voice = (voice + 1) % 97;
        burst({ at: now + i * step + 0.004, freq: 3000 + ((i * 433) % 2200), q: 3, gain: 0.018, attack: 0.001, decay: 0.012, high: 1500 });
      }
    },
    key() {
      if (!live()) return;
      const now = ctx.currentTime;
      voice = (voice + 1) % 97;
      burst({ at: now, freq: 2400, q: 1.6, gain: 0.07, attack: 0.0008, decay: 0.014, high: 1000 });
      burst({ at: now + 0.002, freq: 300, q: 2, gain: 0.09, attack: 0.001, decay: 0.03 });
    },
    destroy() {
      enabled = false;
      stopBed();
      ctx.close().catch(() => {});
    },
  };
}
