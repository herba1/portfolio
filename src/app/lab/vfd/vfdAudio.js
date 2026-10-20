export function createVfdSound() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: "interactive" });
  const length = Math.floor(ctx.sampleRate * 1.2);
  const noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  let seed = 7331;
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 4294967296) * 2 - 1;
  }
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 12;
  comp.ratio.value = 3;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  master.connect(comp);
  comp.connect(ctx.destination);

  const musicGain = ctx.createGain();
  musicGain.gain.value = 0.0001;
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.55;
  analyser.minDecibels = -88;
  analyser.maxDecibels = -18;
  musicGain.connect(analyser);
  analyser.connect(master);
  const bins = new Uint8Array(analyser.frequencyBinCount);

  let enabled = false;
  let voice = 0;
  let buffer = null;
  let loading = null;
  let source = null;
  let paused = false;
  let ducked = false;

  const loadBeat = () => {
    if (!loading) {
      loading = fetch("/blog/audio/friday-beat.wav")
        .then((r) => r.arrayBuffer())
        .then((ab) => ctx.decodeAudioData(ab))
        .then((b) => {
          buffer = b;
          return b;
        })
        .catch(() => null);
    }
    return loading;
  };

  const level = () => (paused ? 0.0001 : ducked ? 0.18 : 0.8);

  const startMusic = async () => {
    const b = await loadBeat();
    if (!b || source || !enabled) return;
    source = ctx.createBufferSource();
    source.buffer = b;
    source.loop = true;
    source.connect(musicGain);
    source.start();
    const now = ctx.currentTime;
    musicGain.gain.cancelScheduledValues(now);
    musicGain.gain.setValueAtTime(0.0001, now);
    musicGain.gain.exponentialRampToValueAtTime(level(), now + 0.35);
  };

  const stopMusic = () => {
    if (!source) return;
    const s = source;
    source = null;
    const now = ctx.currentTime;
    musicGain.gain.cancelScheduledValues(now);
    musicGain.gain.setTargetAtTime(0.0001, now, 0.05);
    s.stop(now + 0.3);
  };

  const burst = ({ at, type = "bandpass", freq, q = 1, gain, attack = 0.001, decay, high = 0, pan = 0 }) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
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
    let out = env;
    if (ctx.createStereoPanner && pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      env.connect(p);
      out = p;
    }
    out.connect(master);
    src.start(at, ((voice * 0.0173) % 1.0) + 0.01, attack + decay + 0.02);
    src.onended = () => out.disconnect();
  };

  const live = () => enabled && ctx.state === "running";

  const setLevel = () => {
    const now = ctx.currentTime;
    musicGain.gain.cancelScheduledValues(now);
    musicGain.gain.setTargetAtTime(level(), now, 0.06);
  };

  return {
    async setEnabled(on) {
      enabled = on;
      if (on) {
        if (ctx.state !== "running") await ctx.resume().catch(() => {});
        if (ctx.state !== "running") return false;
        startMusic();
        return true;
      }
      stopMusic();
      if (ctx.state === "running") window.setTimeout(() => !enabled && ctx.suspend().catch(() => {}), 400);
      return false;
    },
    playing() {
      return Boolean(source) && live() && !paused;
    },
    spectrum() {
      analyser.getByteFrequencyData(bins);
      return { bins, rate: ctx.sampleRate, size: analyser.fftSize };
    },
    setPaused(p) {
      paused = p;
      if (source) setLevel();
    },
    setDucked(d) {
      ducked = d;
      if (source) setLevel();
    },
    click() {
      if (!live()) return;
      const now = ctx.currentTime;
      voice = (voice + 1) % 97;
      burst({ at: now, freq: 3800, q: 1.4, gain: 0.09, attack: 0.0006, decay: 0.01, high: 2000 });
      burst({ at: now + 0.001, freq: 520, q: 2.4, gain: 0.12, attack: 0.001, decay: 0.025 });
      burst({ at: now + 0.045, freq: 2600, q: 2, gain: 0.04, attack: 0.0006, decay: 0.008, high: 1500 });
    },
    tick() {
      if (!live()) return;
      const now = ctx.currentTime;
      voice = (voice + 1) % 97;
      burst({ at: now, freq: 5200, q: 2, gain: 0.035, attack: 0.0005, decay: 0.006, high: 3000, pan: 0.2 });
    },
    destroy() {
      enabled = false;
      stopMusic();
      ctx.close().catch(() => {});
    },
  };
}
