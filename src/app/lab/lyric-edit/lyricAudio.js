const BEAT_URL = "/blog/audio/friday-beat.wav";

export function createLyricAudio() {
  const Ctx = typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext : null;
  let ctx = null;
  let master = null;
  let beatGain = null;
  let fxGain = null;
  let noise = null;
  let buffer = null;
  let loading = null;
  let source = null;
  let voice = 0;

  const build = () => {
    ctx = new Ctx({ latencyHint: "interactive" });
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.15;
    comp.connect(ctx.destination);
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(comp);
    beatGain = ctx.createGain();
    beatGain.gain.value = 0.82;
    beatGain.connect(master);
    fxGain = ctx.createGain();
    fxGain.gain.value = 0.7;
    fxGain.connect(master);
    const length = Math.floor(ctx.sampleRate * 0.5);
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let seed = 99173;
    for (let i = 0; i < length; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 4294967296) * 2 - 1;
    }
  };

  const load = () => {
    if (buffer) return Promise.resolve(buffer);
    if (!loading) {
      loading = fetch(BEAT_URL)
        .then((r) => r.arrayBuffer())
        .then((bytes) => ctx.decodeAudioData(bytes))
        .then((decoded) => {
          buffer = decoded;
          return decoded;
        })
        .catch(() => {
          loading = null;
          return null;
        });
    }
    return loading;
  };

  const stopBeat = () => {
    if (!source) return;
    const s = source;
    source = null;
    try {
      const now = ctx.currentTime;
      s.gainNode.gain.setTargetAtTime(0, now, 0.012);
      s.stop(now + 0.08);
    } catch {
      s.disconnect();
    }
  };

  return {
    get duration() {
      return buffer ? buffer.duration : 5;
    },
    get running() {
      return Boolean(ctx && ctx.state === "running" && source);
    },
    get latency() {
      if (!ctx) return 0;
      return (ctx.outputLatency || 0) + (ctx.baseLatency || 0) * 0.5;
    },
    time() {
      return ctx ? ctx.currentTime : 0;
    },
    async enable() {
      if (!Ctx) return false;
      if (!ctx) build();
      if (ctx.state !== "running") await ctx.resume().catch(() => {});
      const ok = await load();
      return Boolean(ok) && ctx.state === "running";
    },
    async suspend() {
      if (ctx && ctx.state === "running") await ctx.suspend().catch(() => {});
    },
    async resume() {
      if (ctx && ctx.state === "suspended") await ctx.resume().catch(() => {});
    },
    startBeat(when, offset) {
      if (!ctx || !buffer) return;
      stopBeat();
      const s = ctx.createBufferSource();
      s.buffer = buffer;
      s.loop = true;
      s.loopStart = 0;
      s.loopEnd = buffer.duration;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(1, when + 0.006);
      s.connect(g);
      g.connect(beatGain);
      s.gainNode = g;
      const off = ((offset % buffer.duration) + buffer.duration) % buffer.duration;
      s.start(when, off);
      s.onended = () => g.disconnect();
      source = s;
    },
    stopBeat,
    tick(kind) {
      if (!ctx || ctx.state !== "running") return;
      voice = (voice + 1) % 13;
      const now = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.frequency.value = kind === "clear" ? 900 + voice * 20 : 2400 + voice * 70;
      band.Q.value = kind === "clear" ? 0.8 : 2.2;
      const env = ctx.createGain();
      const peak = kind === "clear" ? 0.16 : 0.12;
      const len = kind === "clear" ? 0.16 : 0.03;
      env.gain.setValueAtTime(0.0001, now);
      env.gain.exponentialRampToValueAtTime(peak, now + (kind === "clear" ? 0.02 : 0.001));
      env.gain.exponentialRampToValueAtTime(0.0001, now + len);
      src.connect(band);
      band.connect(env);
      env.connect(fxGain);
      src.start(now, (voice * 0.031) % 0.3, len + 0.02);
      src.onended = () => env.disconnect();
    },
    destroy() {
      stopBeat();
      if (ctx) ctx.close().catch(() => {});
      ctx = null;
    },
  };
}
