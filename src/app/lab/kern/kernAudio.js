export function createKernSound() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: "interactive" });
  const length = Math.floor(ctx.sampleRate * 1.0);
  const noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  let seed = 424242;
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 4294967296) * 2 - 1;
  }
  const master = ctx.createGain();
  master.gain.value = 0.8;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 12;
  comp.ratio.value = 5;
  comp.attack.value = 0.002;
  comp.release.value = 0.14;
  master.connect(comp);
  comp.connect(ctx.destination);

  let enabled = false;
  let voice = 0;
  let lastTick = 0;

  const out = (node, pan) => {
    if (ctx.createStereoPanner && pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-0.8, Math.min(0.8, pan));
      node.connect(p);
      p.connect(master);
      return p;
    }
    node.connect(master);
    return node;
  };

  const burst = ({ at, freq, q = 1, gain, attack = 0.0008, decay = 0.03, pan = 0, high = 0 }) => {
    voice = (voice + 1) % 991;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.frequency.value = freq;
    band.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    let tail = band;
    if (high) {
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = high;
      band.connect(hp);
      tail = hp;
    }
    src.connect(band);
    tail.connect(env);
    const end = out(env, pan);
    src.start(at, ((voice * 0.0213) % 0.9) + 0.01, attack + decay + 0.03);
    src.onended = () => {
      env.disconnect();
      if (end !== env) end.disconnect();
    };
  };

  const body = ({ at, from, to, gain, decay, pan = 0 }) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + decay);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(env);
    const end = out(env, pan);
    osc.start(at);
    osc.stop(at + decay + 0.02);
    osc.onended = () => {
      env.disconnect();
      if (end !== env) end.disconnect();
    };
  };

  const live = () => enabled && ctx.state === "running";

  return {
    async setEnabled(on) {
      enabled = on;
      if (on && ctx.state !== "running") {
        try {
          await ctx.resume();
        } catch {
          return false;
        }
      }
      return ctx.state === "running";
    },
    grab(pan) {
      if (!live()) return;
      const at = ctx.currentTime + 0.002;
      burst({ at, freq: 3400, q: 3, gain: 0.09, decay: 0.018, pan, high: 1400 });
      burst({ at: at + 0.004, freq: 900, q: 1.2, gain: 0.05, decay: 0.03, pan });
    },
    release(energy, pan) {
      if (!live()) return;
      const e = Math.max(0.15, Math.min(1, energy));
      const at = ctx.currentTime + 0.002;
      body({ at, from: 190, to: 96, gain: 0.16 * e, decay: 0.16, pan });
      burst({ at, freq: 1500, q: 0.9, gain: 0.07 * e, decay: 0.05, pan });
    },
    settle(pan, speed) {
      if (!live()) return;
      const now = ctx.currentTime;
      if (now - lastTick < 0.028) return;
      lastTick = now;
      const g = Math.min(0.11, 0.02 + speed * 0.00012);
      burst({ at: now + 0.002, freq: 2600 + ((voice * 53) % 7) * 180, q: 4, gain: g, decay: 0.014, pan, high: 1200 });
    },
    key(pan) {
      if (!live()) return;
      const at = ctx.currentTime + 0.002;
      burst({ at, freq: 2200, q: 2.4, gain: 0.08, decay: 0.022, pan, high: 900 });
      body({ at, from: 240, to: 150, gain: 0.07, decay: 0.07, pan });
    },
    morph(up) {
      if (!live()) return;
      const at = ctx.currentTime + 0.002;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const band = ctx.createBiquadFilter();
      band.type = "bandpass";
      band.Q.value = 1.4;
      band.frequency.setValueAtTime(up ? 380 : 1500, at);
      band.frequency.exponentialRampToValueAtTime(up ? 1300 : 420, at + 0.5);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, at);
      env.gain.exponentialRampToValueAtTime(0.05, at + 0.12);
      env.gain.exponentialRampToValueAtTime(0.0001, at + 0.56);
      src.connect(band);
      band.connect(env);
      env.connect(master);
      src.start(at, 0.1, 0.6);
      src.onended = () => env.disconnect();
    },
    destroy() {
      enabled = false;
      ctx.close().catch(() => {});
    },
  };
}
