export function createSweepSound() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: "interactive" });
  const rate = ctx.sampleRate;
  const length = Math.floor(rate * 1.2);
  const noise = ctx.createBuffer(1, length, rate);
  const data = noise.getChannelData(0);
  let seed = 70411;
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 4294967296) * 2 - 1;
  }

  const irLength = Math.floor(rate * 2.6);
  const ir = ctx.createBuffer(2, irLength, rate);
  for (let ch = 0; ch < 2; ch += 1) {
    const d = ir.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < irLength; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      const n = (seed / 4294967296) * 2 - 1;
      lp += (n - lp) * 0.32;
      const t = i / rate;
      d[i] = lp * Math.exp(-t / 0.62) * (t < 0.012 ? t / 0.012 : 1) * 0.9;
    }
  }

  const master = ctx.createGain();
  master.gain.value = 0.8;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 12;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  master.connect(comp);
  comp.connect(ctx.destination);
  const verb = ctx.createConvolver();
  verb.buffer = ir;
  const verbIn = ctx.createGain();
  verbIn.gain.value = 0.55;
  const verbTone = ctx.createBiquadFilter();
  verbTone.type = "lowpass";
  verbTone.frequency.value = 3200;
  verbIn.connect(verbTone);
  verbTone.connect(verb);
  verb.connect(master);

  let enabled = false;
  let voice = 0;
  let lastKey = 0;
  let lastPing = 0;
  let drone = null;

  const live = () => enabled && ctx.state === "running";

  const panned = (node, pan) => {
    if (!ctx.createStereoPanner) return node;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(p);
    return p;
  };

  const burst = ({ at, type = "bandpass", freq, q = 1, gain, attack = 0.001, decay, pan = 0, high = 0 }) => {
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
    const out = panned(env, pan);
    out.connect(master);
    src.start(at, ((voice * 0.0173) % 1.0) + 0.01, attack + decay + 0.02);
    src.onended = () => out.disconnect();
  };

  const tone = ({ at, freq, gain, attack = 0.004, decay = 1, pan = 0, wet = 0.6, glide = 0, type = "sine" }) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq * (1 + glide), at);
    if (glide) osc.frequency.exponentialRampToValueAtTime(freq, at + 0.06);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    osc.connect(env);
    const out = panned(env, pan);
    out.connect(master);
    const send = ctx.createGain();
    send.gain.value = wet;
    out.connect(send);
    send.connect(verbIn);
    osc.start(at);
    osc.stop(at + attack + decay + 0.05);
    osc.onended = () => {
      out.disconnect();
      send.disconnect();
    };
  };

  const startDrone = () => {
    if (drone) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = "lowpass";
    band.frequency.value = 220;
    band.Q.value = 0.7;
    const osc = ctx.createOscillator();
    osc.frequency.value = 55;
    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.25;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.03, now + 0.8);
    src.connect(band);
    band.connect(g);
    osc.connect(oscGain);
    oscGain.connect(g);
    g.connect(master);
    src.start(now);
    osc.start(now);
    drone = { src, osc, g };
  };

  const stopDrone = () => {
    if (!drone) return;
    const { src, osc, g } = drone;
    drone = null;
    const now = ctx.currentTime;
    g.gain.setTargetAtTime(0.0001, now, 0.06);
    src.stop(now + 0.4);
    osc.stop(now + 0.4);
  };

  return {
    async setEnabled(on) {
      enabled = on;
      if (on) {
        if (ctx.state !== "running") await ctx.resume().catch(() => {});
        if (ctx.state !== "running") return false;
        startDrone();
        const now = ctx.currentTime;
        burst({ at: now, type: "lowpass", freq: 140, q: 0.8, gain: 0.36, attack: 0.004, decay: 0.24 });
        tone({ at: now + 0.03, freq: 880, gain: 0.05, decay: 0.8, wet: 0.8 });
        return true;
      }
      stopDrone();
      if (ctx.state === "running") await ctx.suspend().catch(() => {});
      return false;
    },
    ping(freq, pan, strength = 1) {
      if (!live()) return;
      const now = ctx.currentTime;
      const at = Math.max(now, lastPing + 0.035);
      lastPing = at;
      voice = (voice + 1) % 101;
      const g = 0.11 * strength;
      tone({ at, freq, gain: g, attack: 0.005, decay: 1.25, pan: pan * 0.7, wet: 0.7, glide: 0.012 });
      tone({ at, freq: freq * 2.01, gain: g * 0.22, attack: 0.003, decay: 0.35, pan: pan * 0.7, wet: 0.5 });
      burst({ at, freq: freq * 3, q: 4, gain: 0.02 * strength, attack: 0.001, decay: 0.03, pan: pan * 0.7 });
    },
    key(soft = false) {
      if (!live()) return;
      const now = ctx.currentTime;
      if (now - lastKey < 0.03) return;
      lastKey = now;
      voice = (voice + 1) % 101;
      const v = ((voice * 37) % 17) / 17;
      const level = soft ? 0.45 : 0.8;
      const pan = 0.35 + (((voice * 13) % 9) / 9 - 0.5) * 0.2;
      burst({ at: now, freq: 2900 + v * 1400, q: 1.3, gain: 0.12 * level, attack: 0.0008, decay: 0.014, pan, high: 1200 });
      burst({ at: now + 0.002, freq: 190 + v * 90, q: 2.4, gain: 0.16 * level, attack: 0.002, decay: 0.04, pan });
    },
    lock(pan) {
      if (!live()) return;
      const now = ctx.currentTime;
      burst({ at: now, freq: 2200, q: 1.4, gain: 0.12, attack: 0.0008, decay: 0.02, high: 900, pan });
      burst({ at: now, type: "lowpass", freq: 180, q: 1, gain: 0.25, attack: 0.002, decay: 0.1, pan });
      tone({ at: now + 0.02, freq: 1318.5, gain: 0.05, attack: 0.003, decay: 0.16, wet: 0.3, type: "triangle", pan });
      tone({ at: now + 0.11, freq: 1760, gain: 0.05, attack: 0.003, decay: 0.3, wet: 0.5, type: "triangle", pan });
    },
    release() {
      if (!live()) return;
      const now = ctx.currentTime;
      burst({ at: now, freq: 1600, q: 1.4, gain: 0.08, attack: 0.0008, decay: 0.02, high: 700 });
      tone({ at: now + 0.01, freq: 1174.7, gain: 0.04, attack: 0.003, decay: 0.14, wet: 0.3, type: "triangle" });
      tone({ at: now + 0.09, freq: 880, gain: 0.035, attack: 0.003, decay: 0.3, wet: 0.5, type: "triangle" });
    },
    tick() {
      if (!live()) return;
      const now = ctx.currentTime;
      burst({ at: now, freq: 4200, q: 1.8, gain: 0.05, attack: 0.0006, decay: 0.008, high: 2400 });
    },
    destroy() {
      enabled = false;
      ctx.close().catch(() => {});
    },
  };
}
