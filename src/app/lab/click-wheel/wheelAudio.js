const BEAT_URL = "/blog/audio/friday-beat.wav";

export function createWheelAudio() {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let clickBus = null;
  let noise = null;
  let beat = null;
  let beatPromise = null;
  let source = null;
  let enabled = true;
  let volume = 0.62;
  let voice = 0;
  let lastTick = 0;
  let wantPlaying = false;
  let wantOffset = 0;
  let wantAt = 0;

  const ensure = () => {
    if (ctx) return ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx({ latencyHint: "interactive" });
    master = ctx.createGain();
    master.gain.value = enabled ? 1 : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.002;
    comp.release.value = 0.15;
    master.connect(comp);
    comp.connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.gain.value = volume * volume * 0.9;
    musicGain.connect(master);
    clickBus = ctx.createGain();
    clickBus.gain.value = 0.9;
    clickBus.connect(master);
    const length = Math.floor(ctx.sampleRate * 0.25);
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let seed = 90210;
    for (let i = 0; i < length; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 4294967296) * 2 - 1;
    }
    return ctx;
  };

  const loadBeat = () => {
    if (beatPromise) return beatPromise;
    beatPromise = fetch(BEAT_URL)
      .then((r) => r.arrayBuffer())
      .then((buf) => ctx.decodeAudioData(buf))
      .then((decoded) => {
        beat = decoded;
        if (wantPlaying) startSource(wantOffset + (performance.now() - wantAt) / 1000);
        return decoded;
      })
      .catch(() => null);
    return beatPromise;
  };

  const stopSource = () => {
    if (!source) return;
    const s = source;
    const g = s.fadeGain;
    source = null;
    const now = ctx.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(g.gain.value, now);
    g.gain.linearRampToValueAtTime(0, now + 0.03);
    s.stop(now + 0.04);
    s.onended = () => g.disconnect();
  };

  const startSource = (offset) => {
    if (!ctx || !beat) return;
    stopSource();
    const s = ctx.createBufferSource();
    s.buffer = beat;
    s.loop = true;
    const g = ctx.createGain();
    const now = ctx.currentTime;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(1, now + 0.025);
    s.connect(g);
    g.connect(musicGain);
    s.fadeGain = g;
    s.start(now, ((offset % beat.duration) + beat.duration) % beat.duration);
    source = s;
  };

  const burst = (t, { freq, q, gain, dur, type = "bandpass", offset = 0 }) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.0006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(env);
    env.connect(clickBus);
    src.start(t, offset, dur + 0.01);
    src.onended = () => env.disconnect();
  };

  const pip = (t, freq, gain, dur) => {
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 0.82, t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.0005);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(env);
    env.connect(clickBus);
    o.start(t);
    o.stop(t + dur + 0.01);
    o.onended = () => env.disconnect();
  };

  const live = () => enabled && ctx && ctx.state === "running";

  return {
    arm() {
      if (!enabled) return;
      const c = ensure();
      if (!c) return;
      if (c.state !== "running") c.resume().catch(() => {});
      loadBeat();
    },
    tick() {
      if (!live()) return;
      const now = ctx.currentTime;
      if (now - lastTick < 0.012) return;
      lastTick = now;
      voice = (voice + 1) % 53;
      const v = (voice * 7) % 5;
      burst(now, { freq: 3900 + v * 90, q: 2.4, gain: 0.34, dur: 0.006, offset: (voice * 0.0041) % 0.2 });
      pip(now, 2350 + v * 30, 0.12, 0.007);
      burst(now + 0.0012, { freq: 900, q: 1.2, gain: 0.06, dur: 0.01, offset: 0.11 });
    },
    press(up = false) {
      if (!live()) return;
      const now = ctx.currentTime;
      voice = (voice + 1) % 53;
      burst(now, { freq: up ? 2100 : 1500, q: 1.4, gain: up ? 0.12 : 0.3, dur: up ? 0.012 : 0.018, offset: (voice * 0.0073) % 0.2 });
      burst(now + 0.002, { freq: up ? 520 : 380, q: 2.6, gain: up ? 0.05 : 0.14, dur: 0.03, offset: 0.05 });
      if (!up) burst(now + 0.0035, { freq: 5200, q: 1, gain: 0.06, dur: 0.005, offset: 0.17, type: "highpass" });
    },
    play(offset) {
      wantPlaying = true;
      wantOffset = offset;
      wantAt = performance.now();
      if (ctx && beat) startSource(offset);
    },
    pause() {
      wantPlaying = false;
      if (ctx) stopSource();
    },
    setVolume(v) {
      volume = v;
      if (musicGain) musicGain.gain.setTargetAtTime(v * v * 0.9, ctx.currentTime, 0.02);
    },
    async setEnabled(on) {
      enabled = on;
      if (on) {
        const c = ensure();
        if (!c) return false;
        await c.resume().catch(() => {});
        loadBeat();
        master.gain.setTargetAtTime(1, c.currentTime, 0.02);
        return c.state === "running";
      }
      if (master) master.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      return false;
    },
    destroy() {
      wantPlaying = false;
      if (ctx) {
        stopSource();
        ctx.close().catch(() => {});
      }
      ctx = null;
    },
  };
}
