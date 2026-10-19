const BEAT_URL = "/blog/audio/friday-beat.wav";

export function createCardSound() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: "interactive" });
  const length = Math.floor(ctx.sampleRate * 0.5);
  const noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  let seed = 31337;
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 4294967296) * 2 - 1;
  }
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 10;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.15;
  master.connect(comp);
  comp.connect(ctx.destination);

  let enabled = false;
  let beat = null;
  let loading = null;
  let voice = null;
  let n = 0;

  const loadBeat = () => {
    if (!loading) {
      loading = fetch(BEAT_URL)
        .then((r) => r.arrayBuffer())
        .then((buf) => new Promise((resolve, reject) => ctx.decodeAudioData(buf, resolve, reject)))
        .then((decoded) => {
          beat = decoded;
          return decoded;
        })
        .catch(() => null);
    }
    return loading;
  };

  const burst = ({ freq, q, peak, decay, type = "bandpass", attack = 0.001, at = 0 }) => {
    const now = ctx.currentTime + at;
    n = (n + 1) % 89;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = freq;
    filter.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(peak, now + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
    src.connect(filter);
    filter.connect(env);
    env.connect(master);
    src.start(now, ((n * 0.0191) % 0.4) + 0.01, attack + decay + 0.02);
    src.onended = () => env.disconnect();
  };

  const stopVoice = (fade = 0.08) => {
    if (!voice) return;
    const { src, gain } = voice;
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0, now + fade);
    src.stop(now + fade + 0.02);
    voice = null;
  };

  const ready = () => enabled && ctx.state === "running";

  return {
    async setEnabled(on) {
      enabled = on;
      if (on) {
        if (ctx.state !== "running") await ctx.resume().catch(() => {});
        await loadBeat();
      } else {
        stopVoice(0.05);
        if (ctx.state === "running") await ctx.suspend().catch(() => {});
      }
      return enabled && ctx.state === "running";
    },
    live() {
      return ready() && Boolean(beat);
    },
    startBeat(delay = 0.03) {
      if (!ready() || !beat) return null;
      stopVoice(0.03);
      const src = ctx.createBufferSource();
      src.buffer = beat;
      src.loop = true;
      const gain = ctx.createGain();
      const now = ctx.currentTime + Math.max(0.03, delay);
      gain.gain.setValueAtTime(0, now);
      gain.gain.linearRampToValueAtTime(0.8, now + 0.02);
      src.connect(gain);
      gain.connect(master);
      src.start(now);
      voice = { src, gain };
      return now;
    },
    fadeBeat(seconds) {
      stopVoice(seconds);
    },
    shutter() {
      if (!ready()) return;
      burst({ freq: 3200, q: 1.2, peak: 0.12, decay: 0.02 });
      burst({ freq: 900, q: 2, peak: 0.1, decay: 0.03, at: 0.045 });
      burst({ freq: 170, q: 1, type: "lowpass", peak: 0.16, attack: 0.003, decay: 0.07, at: 0.05 });
    },
    destroy() {
      enabled = false;
      stopVoice(0.02);
      ctx.close().catch(() => {});
    },
  };
}
