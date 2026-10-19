const BEAT_URL = "/blog/audio/friday-beat.wav";

export function createCutAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: "interactive" });
  const length = Math.floor(ctx.sampleRate * 0.8);
  const noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  let seed = 98765;
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 4294967296) * 2 - 1;
  }
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 10;
  comp.ratio.value = 5;
  comp.attack.value = 0.002;
  comp.release.value = 0.14;
  comp.connect(ctx.destination);
  const fx = ctx.createGain();
  fx.gain.value = 0.9;
  fx.connect(comp);
  const beatGain = ctx.createGain();
  beatGain.gain.value = 0.5;
  beatGain.connect(comp);

  let enabled = false;
  let beat = null;
  let beatSource = null;
  let beatLoading = null;
  let voice = 0;
  const last = {};

  const loadBeat = () => {
    if (beat || beatLoading) return beatLoading;
    beatLoading = fetch(BEAT_URL)
      .then((r) => r.arrayBuffer())
      .then((buf) => ctx.decodeAudioData(buf))
      .then((decoded) => {
        beat = decoded;
        return decoded;
      })
      .catch(() => null);
    return beatLoading;
  };

  const panner = (value) => {
    if (!ctx.createStereoPanner) return null;
    const p = ctx.createStereoPanner();
    p.pan.value = value;
    p.connect(fx);
    return p;
  };

  const burst = ({ at, type, freq, q, gain, attack, decay, offset, pan = 0, sweepTo }) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, at);
    if (sweepTo) filter.frequency.exponentialRampToValueAtTime(sweepTo, at + attack + decay);
    filter.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    src.connect(filter);
    filter.connect(env);
    env.connect(panner(pan) || fx);
    src.start(at, offset, attack + decay + 0.02);
    src.onended = () => env.disconnect();
  };

  const thump = (at, from, to, gain, decay) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + decay);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(env);
    env.connect(fx);
    osc.start(at);
    osc.stop(at + decay + 0.02);
    osc.onended = () => env.disconnect();
  };

  const sounds = {
    pop(at, v, pan) {
      burst({ at, type: "bandpass", freq: 1500 + (v % 7) * 90, q: 1.4, gain: 0.16, attack: 0.002, decay: 0.03, offset: (v * 0.031) % 0.6, pan });
      burst({ at: at + 0.002, type: "lowpass", freq: 900, q: 0.7, gain: 0.08, attack: 0.003, decay: 0.05, offset: (v * 0.017) % 0.6, pan });
    },
    key(at, v, pan) {
      burst({ at, type: "highpass", freq: 3200 + (v % 5) * 260, q: 0.8, gain: 0.12, attack: 0.001, decay: 0.012, offset: (v * 0.043) % 0.6, pan });
      burst({ at: at + 0.004, type: "bandpass", freq: 1100 + (v % 3) * 120, q: 3, gain: 0.1, attack: 0.002, decay: 0.028, offset: (v * 0.029) % 0.6, pan });
    },
    swoosh(at, v, pan) {
      burst({ at, type: "bandpass", freq: 500, sweepTo: 2600, q: 0.9, gain: 0.11, attack: 0.07, decay: 0.22, offset: (v * 0.05) % 0.4, pan });
    },
    cut(at) {
      thump(at, 92, 42, 0.42, 0.16);
      burst({ at, type: "lowpass", freq: 520, q: 0.8, gain: 0.12, attack: 0.002, decay: 0.06, offset: 0.2 });
    },
    save(at) {
      thump(at, 520, 760, 0.07, 0.07);
      burst({ at, type: "bandpass", freq: 2400, q: 2, gain: 0.08, attack: 0.002, decay: 0.03, offset: 0.12 });
    },
  };

  const stopBeat = () => {
    if (!beatSource) return;
    const src = beatSource;
    beatSource = null;
    try {
      src.stop();
    } catch {
      src.disconnect();
    }
  };

  return {
    get enabled() {
      return enabled;
    },
    async setEnabled(on) {
      enabled = on;
      if (on) {
        if (ctx.state !== "running") await ctx.resume().catch(() => {});
        await loadBeat();
      } else {
        stopBeat();
        if (ctx.state === "running") await ctx.suspend().catch(() => {});
      }
      return enabled && ctx.state === "running";
    },
    play(kind, pan = 0) {
      if (!enabled || ctx.state !== "running") return;
      const now = ctx.currentTime;
      if (last[kind] && now - last[kind] < 0.035) return;
      last[kind] = now;
      voice = (voice + 1) % 101;
      sounds[kind]?.(now + 0.005, voice, pan);
    },
    startBeat(offset) {
      stopBeat();
      if (!enabled || !beat || ctx.state !== "running") return null;
      const src = ctx.createBufferSource();
      src.buffer = beat;
      src.loop = true;
      src.connect(beatGain);
      const at = ctx.currentTime + 0.012;
      src.start(at, ((offset % beat.duration) + beat.duration) % beat.duration);
      beatSource = src;
      return at;
    },
    clock() {
      return ctx.currentTime;
    },
    stopBeat,
    destroy() {
      enabled = false;
      stopBeat();
      ctx.close().catch(() => {});
    },
  };
}
