export function createStrikeSound() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  let ctx = null;
  let master = null;
  let noise = null;
  let enabled = false;
  let voice = 0;

  const build = () => {
    ctx = new Ctx({ latencyHint: "interactive" });
    const length = Math.floor(ctx.sampleRate * 1.2);
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let seed = 1234567;
    for (let i = 0; i < length; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 4294967296) * 2 - 1;
    }
    master = ctx.createGain();
    master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 8;
    comp.ratio.value = 4;
    comp.attack.value = 0.002;
    comp.release.value = 0.12;
    const room = ctx.createConvolver();
    const irLen = Math.floor(ctx.sampleRate * 0.18);
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let c = 0; c < 2; c += 1) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < irLen; i += 1) {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        ch[i] = ((seed / 4294967296) * 2 - 1) * Math.pow(1 - i / irLen, 3.2) * 0.5;
      }
    }
    room.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.16;
    master.connect(comp);
    master.connect(room);
    room.connect(wet);
    wet.connect(comp);
    comp.connect(ctx.destination);
  };

  const live = () => enabled && ctx && ctx.state === "running";

  const out = (node, pan) => {
    if (ctx.createStereoPanner && pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = Math.max(-0.9, Math.min(0.9, pan));
      node.connect(p);
      p.connect(master);
      return p;
    }
    node.connect(master);
    return node;
  };

  const burst = (at, { freq, q = 1, type = "bandpass", gain, decay, pan = 0, length = 0.03 }) => {
    voice = (voice + 1) % 997;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.0012);
    g.gain.setTargetAtTime(0, at + 0.0012, decay);
    src.connect(f);
    f.connect(g);
    const end = out(g, pan);
    const dur = length + decay * 7;
    src.start(at, ((voice * 0.0371) % 1.0) + 0.02, dur);
    src.onended = () => {
      g.disconnect();
      if (end !== g) end.disconnect();
    };
  };

  const tone = (at, { freq, gain, decay, pan = 0, type = "sine", drop = 1 }) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, at);
    if (drop !== 1) o.frequency.exponentialRampToValueAtTime(freq * drop, at + decay * 3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(gain, at + 0.002);
    g.gain.setTargetAtTime(0, at + 0.002, decay);
    o.connect(g);
    const end = out(g, pan);
    o.start(at);
    o.stop(at + decay * 8 + 0.02);
    o.onended = () => {
      g.disconnect();
      if (end !== g) end.disconnect();
    };
  };

  return {
    async setEnabled(on) {
      enabled = on;
      if (on) {
        if (!ctx) {
          try {
            build();
          } catch {
            enabled = false;
            return false;
          }
        }
        if (ctx.state !== "running") {
          try {
            await ctx.resume();
          } catch {
            return false;
          }
        }
        const now = ctx.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.linearRampToValueAtTime(0.8, now + 0.08);
        return ctx.state === "running";
      }
      return false;
    },
    strike(force, pan, jitter, heavy) {
      if (!live()) return;
      const at = ctx.currentTime + 0.003;
      const f = Math.max(0.5, Math.min(1.4, force)) * (heavy ? 1.15 : 1);
      burst(at, { freq: 2500 + jitter * 900, q: 1.3, gain: 0.5 * f, decay: 0.011, pan, length: 0.02 });
      burst(at, { freq: 5600 + jitter * 1400, q: 2.4, gain: 0.2 * f, decay: 0.005, pan, length: 0.01 });
      burst(at, { freq: 380, q: 0.8, type: "lowpass", gain: 0.55 * f, decay: 0.02, pan: pan * 0.5, length: 0.03 });
      tone(at, { freq: 112 + jitter * 18, gain: 0.24 * f, decay: 0.028, drop: 0.8 });
      tone(at + 0.0006, { freq: 3300 + jitter * 500, gain: 0.02 * f, decay: 0.018, pan });
      burst(at + 0.034 + jitter * 0.006, { freq: 3900, q: 3, gain: 0.07, decay: 0.004, pan: pan * 0.8, length: 0.008 });
    },
    space(pan) {
      if (!live()) return;
      const at = ctx.currentTime + 0.003;
      burst(at, { freq: 820, q: 0.9, gain: 0.26, decay: 0.02, pan: pan * 0.4, length: 0.03 });
      tone(at, { freq: 92, gain: 0.15, decay: 0.035 });
      burst(at + 0.04, { freq: 3900, q: 3, gain: 0.07, decay: 0.004, pan, length: 0.008 });
    },
    back(pan) {
      if (!live()) return;
      const at = ctx.currentTime + 0.003;
      burst(at, { freq: 1700, q: 1.2, gain: 0.24, decay: 0.013, pan, length: 0.02 });
      burst(at + 0.028, { freq: 3300, q: 2, gain: 0.1, decay: 0.006, pan, length: 0.01 });
    },
    bell() {
      if (!live()) return;
      const at = ctx.currentTime + 0.004;
      const base = 2217;
      for (const [ratio, gain, decay] of [
        [1, 0.15, 0.85],
        [2.76, 0.06, 0.38],
        [5.4, 0.03, 0.18],
        [8.93, 0.015, 0.09],
      ]) {
        tone(at, { freq: base * ratio, gain, decay, pan: 0.6 });
      }
      burst(at, { freq: 6200, q: 2, gain: 0.05, decay: 0.004, pan: 0.6, length: 0.006 });
    },
    carriage(duration) {
      if (!live()) return;
      const at = ctx.currentTime + 0.004;
      for (let i = 0; i < 2; i += 1) {
        burst(at + i * 0.024, { freq: 3100 - i * 500, q: 2.2, gain: 0.16 - i * 0.05, decay: 0.006, pan: -0.55, length: 0.01 });
      }
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = 1.5;
      const t1 = at + 0.05;
      f.frequency.setValueAtTime(650, t1);
      f.frequency.linearRampToValueAtTime(1500, t1 + duration);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t1);
      g.gain.linearRampToValueAtTime(0.08, t1 + 0.04);
      g.gain.setValueAtTime(0.08, t1 + Math.max(0.05, duration - 0.05));
      g.gain.linearRampToValueAtTime(0, t1 + duration);
      src.connect(f);
      f.connect(g);
      const end = out(g, 0.15);
      src.start(t1);
      src.stop(t1 + duration + 0.05);
      src.onended = () => {
        g.disconnect();
        if (end !== g) end.disconnect();
      };
      const stop = t1 + duration;
      burst(stop, { freq: 560, q: 0.7, type: "lowpass", gain: 0.5, decay: 0.03, pan: -0.6, length: 0.04 });
      burst(stop, { freq: 2100, q: 1.1, gain: 0.26, decay: 0.012, pan: -0.6, length: 0.02 });
      tone(stop, { freq: 80, gain: 0.28, decay: 0.05, pan: -0.4, drop: 0.85 });
    },
    feed(duration) {
      if (!live()) return;
      const at = ctx.currentTime + 0.01;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = 0.9;
      f.frequency.setValueAtTime(420, at);
      f.frequency.linearRampToValueAtTime(1100, at + duration);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, at);
      g.gain.linearRampToValueAtTime(0.07, at + 0.12);
      g.gain.linearRampToValueAtTime(0, at + duration);
      src.connect(f);
      f.connect(g);
      g.connect(master);
      src.start(at);
      src.stop(at + duration + 0.05);
      src.onended = () => g.disconnect();
      const clicks = Math.round(duration / 0.06);
      for (let i = 0; i < clicks; i += 1) burst(at + i * 0.06, { freq: 2600, q: 2, gain: 0.05, decay: 0.005, pan: -0.5, length: 0.008 });
    },
    destroy() {
      enabled = false;
      if (ctx) ctx.close().catch(() => {});
      ctx = null;
    },
  };
}
