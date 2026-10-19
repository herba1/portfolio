const BEAT_URL = "/blog/audio/friday-beat.wav";

export function createWordAudio() {
  const Ctx = typeof window !== "undefined" ? window.AudioContext || window.webkitAudioContext : null;
  let ctx = null;
  let master = null;
  let beatGain = null;
  let fx = null;
  let noise = null;
  let buffer = null;
  let loading = null;
  let source = null;
  let voice = 0;

  const build = () => {
    ctx = new Ctx({ latencyHint: "interactive" });
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.002;
    comp.release.value = 0.14;
    comp.connect(ctx.destination);
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(comp);
    beatGain = ctx.createGain();
    beatGain.gain.value = 0.5;
    beatGain.connect(master);
    fx = ctx.createGain();
    fx.gain.value = 0.8;
    fx.connect(master);
    const length = Math.floor(ctx.sampleRate * 0.5);
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let seed = 4711;
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

  const startBeat = () => {
    if (!buffer || source) return;
    const when = ctx.currentTime + 0.03;
    const s = ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = true;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(1, when + 0.4);
    s.connect(g);
    g.connect(beatGain);
    s.start(when);
    s.onended = () => g.disconnect();
    source = { s, g };
  };

  const stopBeat = () => {
    if (!source) return;
    const { s, g } = source;
    source = null;
    const now = ctx.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setTargetAtTime(0, now, 0.05);
    s.stop(now + 0.3);
  };

  const burst = (freq, q, peak, len, pan, type = "bandpass") => {
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(peak, now + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, now + len);
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (p.pan) p.pan.value = pan;
    src.connect(f);
    f.connect(env);
    env.connect(p);
    p.connect(fx);
    src.start(now, (voice * 0.037) % 0.4, len + 0.02);
    src.onended = () => p.disconnect();
  };

  return {
    async enable() {
      if (!Ctx) return false;
      if (!ctx) build();
      if (ctx.state !== "running") await ctx.resume().catch(() => {});
      const ok = await load();
      if (ok && ctx.state === "running") startBeat();
      return Boolean(ok) && ctx.state === "running";
    },
    async disable() {
      if (!ctx) return;
      stopBeat();
    },
    async suspend() {
      if (ctx && ctx.state === "running") await ctx.suspend().catch(() => {});
    },
    async resume() {
      if (ctx && ctx.state === "suspended" && source) await ctx.resume().catch(() => {});
    },
    pop(pan) {
      if (!ctx || ctx.state !== "running" || !source) return;
      voice = (voice + 1) % 11;
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      const base = 620 + voice * 23;
      osc.frequency.setValueAtTime(base * 1.9, now);
      osc.frequency.exponentialRampToValueAtTime(base, now + 0.035);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, now);
      env.gain.exponentialRampToValueAtTime(0.2, now + 0.003);
      env.gain.exponentialRampToValueAtTime(0.0001, now + 0.07);
      const p = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
      if (p.pan) p.pan.value = pan * 0.6;
      osc.connect(env);
      env.connect(p);
      p.connect(fx);
      osc.start(now);
      osc.stop(now + 0.09);
      osc.onended = () => p.disconnect();
      burst(3800 + voice * 90, 1.4, 0.07, 0.018, pan * 0.6);
    },
    cut() {
      if (!ctx || ctx.state !== "running" || !source) return;
      voice = (voice + 1) % 11;
      burst(1400, 0.6, 0.22, 0.05, 0, "lowpass");
      burst(5200, 0.9, 0.05, 0.03, 0);
    },
    destroy() {
      if (ctx) {
        stopBeat();
        ctx.close().catch(() => {});
      }
      ctx = null;
    },
  };
}
