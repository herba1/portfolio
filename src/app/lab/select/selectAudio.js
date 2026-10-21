export function createAudio() {
  let ctx = null;
  let noise = null;
  let out = null;
  let enabled = true;
  let voice = 0;
  let lastTick = 0;

  const ensure = () => {
    if (ctx) return ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx({ latencyHint: "interactive" });
    const length = Math.floor(ctx.sampleRate * 0.6);
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let seed = 77123;
    for (let i = 0; i < length; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 4294967296) * 2 - 1;
    }
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -20;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.002;
    comp.release.value = 0.12;
    out = ctx.createGain();
    out.gain.value = 0.85;
    out.connect(comp);
    comp.connect(ctx.destination);
    return ctx;
  };

  const live = () => enabled && ctx && ctx.state === "running";

  const route = (node, pan) => {
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-0.7, Math.min(0.7, pan));
      node.connect(p);
      p.connect(out);
    } else {
      node.connect(out);
    }
  };

  const burst = (now, { pan = 0, freq, q, gain, attack = 0.001, decay, offset, type = "bandpass" }) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(gain, now + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
    src.connect(f);
    f.connect(env);
    route(env, pan);
    src.start(now, offset % 0.5, attack + decay + 0.02);
    src.onended = () => env.disconnect();
  };

  const tone = (now, { freq, to, gain, decay, pan = 0, type = "sine" }) => {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, now + decay);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(gain, now + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    osc.connect(env);
    route(env, pan);
    osc.start(now);
    osc.stop(now + decay + 0.02);
    osc.onended = () => env.disconnect();
  };

  return {
    unlock() {
      if (!enabled) return;
      const c = ensure();
      if (c && c.state !== "running") c.resume().catch(() => {});
    },
    async setEnabled(on) {
      enabled = on;
      const c = on ? ensure() : ctx;
      if (!c) return false;
      if (on && c.state !== "running") await c.resume().catch(() => {});
      if (!on && c.state === "running") await c.suspend().catch(() => {});
      return on;
    },
    tick(pan) {
      if (!live()) return;
      const now = ctx.currentTime;
      if (now - lastTick < 0.035) return;
      lastTick = now;
      voice = (voice + 1) % 53;
      burst(now, { pan, freq: 3400 + (voice % 5) * 180, q: 4, gain: 0.06, decay: 0.012, offset: voice * 0.0131 });
      tone(now, { freq: 180, to: 120, gain: 0.07, decay: 0.03, pan });
    },
    lift(pan) {
      if (!live()) return;
      const now = ctx.currentTime;
      burst(now, { pan, freq: 1400, q: 0.8, gain: 0.05, attack: 0.04, decay: 0.22, offset: 0.13 });
      tone(now, { freq: 520, to: 760, gain: 0.025, decay: 0.16, pan });
    },
    settle(pan) {
      if (!live()) return;
      const now = ctx.currentTime;
      burst(now, { pan, freq: 2200, q: 1.6, gain: 0.08, decay: 0.03, offset: 0.27 });
      tone(now, { freq: 240, to: 150, gain: 0.08, decay: 0.06, pan });
    },
    pop() {
      if (!live()) return;
      const now = ctx.currentTime;
      tone(now, { freq: 660, to: 990, gain: 0.05, decay: 0.09 });
      tone(now + 0.07, { freq: 990, to: 1320, gain: 0.04, decay: 0.12 });
    },
    whoosh() {
      if (!live()) return;
      const now = ctx.currentTime;
      burst(now, { freq: 1800, q: 0.7, gain: 0.06, attack: 0.08, decay: 0.3, offset: 0.31 });
    },
    destroy() {
      enabled = false;
      if (ctx) ctx.close().catch(() => {});
      ctx = null;
    },
  };
}
