export function createHalftoneSound() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: "interactive" });
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * 2);
  const noise = ctx.createBuffer(1, length, rate);
  const data = noise.getChannelData(0);
  let seed = 31337;
  let brown = 0;
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    const white = (seed / 4294967296) * 2 - 1;
    brown = brown * 0.6 + white * 0.4;
    const grit = (seed >>> 7) % 997 === 0 ? white * 4 : 0;
    data[i] = brown * 0.9 + grit;
  }
  const fadeLen = 2000;
  for (let i = 0; i < fadeLen; i += 1) {
    const k = i / fadeLen;
    data[length - fadeLen + i] = data[length - fadeLen + i] * (1 - k) + data[i] * k;
  }

  const master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 10;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.15;
  master.connect(comp);
  comp.connect(ctx.destination);

  let enabled = false;
  let voice = 0;
  let rustle = null;

  const live = () => enabled && ctx.state === "running";

  const burst = ({ at, type = "bandpass", freq, q = 1, gain, attack = 0.002, decay, pan = 0, high = 0, sweep = 0 }) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, at);
    if (sweep) filter.frequency.exponentialRampToValueAtTime(freq * sweep, at + attack + decay);
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
    let out = env;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, pan));
      env.connect(p);
      out = p;
    }
    out.connect(master);
    voice = (voice + 1) % 97;
    src.start(at, (voice * 0.0191) % 1.6, attack + decay + 0.03);
    src.onended = () => out.disconnect();
  };

  const startRustle = () => {
    if (rustle) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = 2400;
    band.Q.value = 0.7;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 500;
    const body = ctx.createBiquadFilter();
    body.type = "lowpass";
    body.frequency.value = 420;
    const bodyGain = ctx.createGain();
    bodyGain.gain.value = 0.35;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    src.connect(band);
    band.connect(hp);
    hp.connect(g);
    src.connect(body);
    body.connect(bodyGain);
    bodyGain.connect(g);
    if (pan) {
      g.connect(pan);
      pan.connect(master);
    } else g.connect(master);
    src.start(now, 0.3);
    rustle = { src, band, g, pan };
  };

  return {
    async setEnabled(on) {
      enabled = on;
      if (on) {
        if (ctx.state !== "running") await ctx.resume().catch(() => {});
        if (ctx.state !== "running") return false;
        startRustle();
        return true;
      }
      if (rustle) rustle.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.02);
      if (ctx.state === "running") await ctx.suspend().catch(() => {});
      return false;
    },
    press(pan = 0) {
      if (!live()) return;
      const now = ctx.currentTime;
      burst({ at: now, type: "lowpass", freq: 210, q: 0.9, gain: 0.32, attack: 0.004, decay: 0.16, pan: pan * 0.5 });
      burst({ at: now + 0.004, freq: 1500, q: 0.8, gain: 0.08, attack: 0.003, decay: 0.07, pan: pan * 0.5, high: 600 });
      burst({ at: now + 0.012, freq: 4200, q: 1.2, gain: 0.035, attack: 0.002, decay: 0.05, pan: pan * 0.5, high: 2500 });
    },
    drag(speed, pan = 0) {
      if (!rustle || !live()) return;
      const now = ctx.currentTime;
      const s = Math.min(1, speed / 1600);
      const level = s > 0.01 ? 0.004 + Math.pow(s, 1.3) * 0.11 : 0.0001;
      rustle.g.gain.setTargetAtTime(level, now, 0.05);
      rustle.band.frequency.setTargetAtTime(1500 + s * 2600, now, 0.08);
      if (rustle.pan) rustle.pan.pan.setTargetAtTime(Math.max(-0.8, Math.min(0.8, pan * 0.6)), now, 0.08);
      if (s > 0.25 && (voice * 7) % 5 === 0) burst({ at: now, freq: 5200 + s * 1800, q: 2, gain: 0.025 * s, attack: 0.001, decay: 0.012, pan, high: 3000 });
      voice = (voice + 1) % 97;
    },
    release(pan = 0) {
      if (!live()) return;
      const now = ctx.currentTime;
      if (rustle) rustle.g.gain.setTargetAtTime(0.0001, now, 0.09);
      burst({ at: now, type: "lowpass", freq: 1400, q: 0.6, gain: 0.05, attack: 0.03, decay: 0.38, pan: pan * 0.5, sweep: 0.35 });
    },
    impression() {
      if (!live()) return;
      const now = ctx.currentTime;
      burst({ at: now, type: "lowpass", freq: 120, q: 1, gain: 0.26, attack: 0.006, decay: 0.24 });
      burst({ at: now + 0.01, freq: 900, q: 0.9, gain: 0.06, attack: 0.004, decay: 0.12, high: 300 });
      burst({ at: now + 0.16, freq: 3000, q: 0.7, gain: 0.04, attack: 0.04, decay: 0.42, high: 1200, sweep: 0.6 });
    },
    destroy() {
      enabled = false;
      ctx.close().catch(() => {});
    },
  };
}
