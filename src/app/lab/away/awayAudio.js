export function createAwayAudio() {
  let ctx = null;
  let master = null;
  let noise = null;
  let enabled = true;

  const ensure = () => {
    if (ctx) return ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    ctx = new Ctx({ latencyHint: "interactive" });
    master = ctx.createGain();
    master.gain.value = enabled ? 0.9 : 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    master.connect(comp);
    comp.connect(ctx.destination);
    const length = Math.floor(ctx.sampleRate * 1.2);
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const d = noise.getChannelData(0);
    let seed = 1999;
    for (let i = 0; i < length; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      d[i] = (seed / 4294967296) * 2 - 1;
    }
    return ctx;
  };

  const live = () => enabled && ctx && ctx.state === "running";

  const noiseHit = (t, { type = "bandpass", freq, q = 1, gain, attack = 0.001, dur, offset = 0, pan = 0, sweepTo = null }) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f);
    f.connect(env);
    let out = env;
    if (ctx.createStereoPanner && pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      env.connect(p);
      out = p;
    }
    out.connect(master);
    src.start(t, offset, dur + 0.05);
    src.onended = () => out.disconnect();
  };

  const tone = (t, freq, gain, dur, type = "sine", glideTo = null) => {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t + dur * 0.6);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(env);
    env.connect(master);
    o.start(t);
    o.stop(t + dur + 0.02);
    o.onended = () => env.disconnect();
  };

  const creak = (t, dur, from, to, gain, pan) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = "bandpass";
    f.Q.value = 14;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + dur);
    const am = ctx.createGain();
    am.gain.value = 0;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + 0.04);
    env.gain.setValueAtTime(gain, t + dur * 0.7);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const steps = Math.floor(dur * 46);
    let tt = t;
    for (let i = 0; i < steps; i += 1) {
      const gap = 1 / (34 + ((i * 7) % 13) * 2.4);
      am.gain.setValueAtTime(0.0, tt);
      am.gain.linearRampToValueAtTime(1, tt + gap * 0.18);
      am.gain.linearRampToValueAtTime(0.15, tt + gap * 0.9);
      tt += gap;
      if (tt > t + dur) break;
    }
    src.connect(f);
    f.connect(am);
    am.connect(env);
    let out = env;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      env.connect(p);
      out = p;
    }
    out.connect(master);
    src.start(t, 0.1, dur + 0.05);
    src.onended = () => out.disconnect();
  };

  return {
    arm() {
      if (!enabled) return;
      const c = ensure();
      if (c && c.state !== "running") c.resume().catch(() => {});
    },
    doorOpen(pan = 0.3) {
      if (!live()) return;
      const t = ctx.currentTime + 0.01;
      noiseHit(t, { freq: 2600, q: 2, gain: 0.16, dur: 0.02, pan });
      noiseHit(t + 0.006, { freq: 700, q: 3, gain: 0.1, dur: 0.05, offset: 0.3, pan });
      creak(t + 0.06, 0.62, 520, 980, 0.32, pan);
      noiseHit(t + 0.06, { type: "lowpass", freq: 600, q: 0.7, gain: 0.05, attack: 0.15, dur: 0.7, offset: 0.5, pan });
    },
    doorClose(pan = -0.3) {
      if (!live()) return;
      const t = ctx.currentTime + 0.01;
      creak(t, 0.22, 900, 640, 0.18, pan);
      noiseHit(t + 0.22, { type: "lowpass", freq: 180, q: 1.2, gain: 0.5, dur: 0.24, offset: 0.7, pan });
      tone(t + 0.22, 88, 0.22, 0.2, "sine", 62);
      noiseHit(t + 0.225, { freq: 1900, q: 2.4, gain: 0.2, dur: 0.03, offset: 0.2, pan });
      noiseHit(t + 0.26, { freq: 3200, q: 3, gain: 0.08, dur: 0.02, offset: 0.9, pan });
    },
    imIn() {
      if (!live()) return;
      const t = ctx.currentTime + 0.01;
      tone(t, 1318.5, 0.16, 0.22, "triangle");
      tone(t + 0.11, 1760, 0.14, 0.42, "triangle");
      tone(t + 0.11, 880, 0.05, 0.42, "sine");
    },
    imOut() {
      if (!live()) return;
      const t = ctx.currentTime + 0.01;
      noiseHit(t, { freq: 900, q: 1.6, gain: 0.14, attack: 0.05, dur: 0.28, sweepTo: 3600 });
    },
    away(on) {
      if (!live()) return;
      const t = ctx.currentTime + 0.01;
      const notes = on ? [784, 659.3, 523.3] : [523.3, 659.3, 784];
      notes.forEach((f, i) => tone(t + i * 0.09, f, 0.1, 0.5, "sine"));
    },
    click() {
      if (!live()) return;
      const t = ctx.currentTime;
      noiseHit(t, { freq: 3000, q: 1.8, gain: 0.08, dur: 0.012, offset: 0.4 });
      noiseHit(t + 0.002, { freq: 600, q: 2.4, gain: 0.05, dur: 0.025, offset: 0.6 });
    },
    key() {
      if (!live()) return;
      const t = ctx.currentTime;
      noiseHit(t, { freq: 4200, q: 2, gain: 0.025, dur: 0.01, offset: 0.8 });
    },
    async setEnabled(on) {
      enabled = on;
      if (on) {
        const c = ensure();
        if (!c) return false;
        await c.resume().catch(() => {});
        master.gain.setTargetAtTime(0.9, c.currentTime, 0.02);
        return c.state === "running";
      }
      if (master) master.gain.setTargetAtTime(0, ctx.currentTime, 0.02);
      return false;
    },
    destroy() {
      if (ctx) ctx.close().catch(() => {});
      ctx = null;
    },
  };
}
