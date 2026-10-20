export function createPlotSound() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  let ctx = null;
  let master = null;
  let noise = null;
  let motors = [];
  let enabled = false;

  const build = () => {
    ctx = new Ctx({ latencyHint: "interactive" });
    const length = Math.floor(ctx.sampleRate * 2);
    noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = noise.getChannelData(0);
    let seed = 90210;
    for (let i = 0; i < length; i += 1) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 4294967296) * 2 - 1;
    }
    master = ctx.createGain();
    master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 10;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.2;
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 6200;
    tone.Q.value = 0.4;
    master.connect(tone);
    tone.connect(comp);
    comp.connect(ctx.destination);
    motors = [-0.35, 0.35].map((pan, k) => {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = 200;
      const sub = ctx.createOscillator();
      sub.type = "sine";
      sub.frequency.value = 400;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 1800;
      lp.Q.value = 0.7;
      const peak = ctx.createBiquadFilter();
      peak.type = "peaking";
      peak.frequency.value = 2400 + k * 500;
      peak.Q.value = 3;
      peak.gain.value = 9;
      const sq = ctx.createGain();
      sq.gain.value = 0.32;
      const sn = ctx.createGain();
      sn.gain.value = 0.5;
      const env = ctx.createGain();
      env.gain.value = 0;
      osc.connect(sq);
      sq.connect(lp);
      sub.connect(sn);
      sn.connect(lp);
      lp.connect(peak);
      peak.connect(env);
      let out = env;
      if (ctx.createStereoPanner) {
        const p = ctx.createStereoPanner();
        p.pan.value = pan;
        env.connect(p);
        out = p;
      }
      out.connect(master);
      osc.start();
      sub.start();
      return { osc, sub, env, lp, level: 0, freq: 200 };
    });
  };

  const live = () => enabled && ctx && ctx.state === "running";

  const burst = (at, { freq, q = 1, gain, decay, pan = 0, type = "bandpass", offset = 0 }) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.0015);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.0015 + decay);
    src.connect(f);
    f.connect(g);
    let end = g;
    if (ctx.createStereoPanner && pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      end = p;
    }
    end.connect(master);
    src.start(at, offset, decay + 0.05);
    src.onended = () => {
      g.disconnect();
      if (end !== g) end.disconnect();
    };
  };

  const thump = (at, freq, gain, decay, pan = 0) => {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(freq * 1.6, at);
    o.frequency.exponentialRampToValueAtTime(freq, at + decay * 0.6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(gain, at + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    o.connect(g);
    let end = g;
    if (ctx.createStereoPanner && pan) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      end = p;
    }
    end.connect(master);
    o.start(at);
    o.stop(at + decay + 0.03);
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
        master.gain.linearRampToValueAtTime(0.9, now + 0.3);
        return ctx.state === "running";
      }
      if (ctx) {
        const now = ctx.currentTime;
        master.gain.cancelScheduledValues(now);
        master.gain.setValueAtTime(master.gain.value, now);
        master.gain.linearRampToValueAtTime(0, now + 0.1);
      }
      return false;
    },
    motion(ax, ay, down) {
      if (!live()) return;
      const now = ctx.currentTime;
      [ax, ay].forEach((s, k) => {
        const m = motors[k];
        const sp = Math.max(0, Math.min(1.6, s));
        const freq = 150 + sp * 820 + k * 9;
        const level = sp < 0.015 ? 0 : (0.018 + 0.05 * Math.sqrt(Math.min(1, sp))) * (down ? 1 : 0.8);
        m.osc.frequency.setTargetAtTime(freq, now, 0.025);
        m.sub.frequency.setTargetAtTime(freq * 2, now, 0.025);
        m.lp.frequency.setTargetAtTime(1200 + sp * 1600, now, 0.05);
        m.env.gain.setTargetAtTime(level, now, 0.03);
      });
    },
    quiet() {
      if (!ctx) return;
      const now = ctx.currentTime;
      motors.forEach((m) => m.env.gain.setTargetAtTime(0, now, 0.03));
    },
    pen(down, pan = 0) {
      if (!live()) return;
      const at = ctx.currentTime + 0.003;
      if (down) {
        burst(at, { freq: 2600, q: 2.2, gain: 0.11, decay: 0.014, pan, offset: 0.31 });
        burst(at + 0.002, { freq: 700, q: 1, gain: 0.08, decay: 0.03, pan, offset: 0.7 });
        thump(at, 140, 0.12, 0.06, pan);
      } else {
        burst(at, { freq: 3400, q: 2.6, gain: 0.06, decay: 0.01, pan, offset: 1.1 });
        thump(at, 210, 0.05, 0.04, pan);
      }
    },
    lift() {
      if (!live()) return;
      const at = ctx.currentTime + 0.01;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = 0.8;
      f.frequency.setValueAtTime(500, at);
      f.frequency.exponentialRampToValueAtTime(2600, at + 0.9);
      f.frequency.exponentialRampToValueAtTime(1200, at + 1.5);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(0.07, at + 0.25);
      g.gain.exponentialRampToValueAtTime(0.03, at + 0.9);
      g.gain.exponentialRampToValueAtTime(0.0001, at + 1.6);
      src.connect(f);
      f.connect(g);
      g.connect(master);
      src.start(at, 0.2, 1.7);
      src.onended = () => g.disconnect();
      thump(at + 1.35, 90, 0.07, 0.12);
    },
    destroy() {
      enabled = false;
      if (ctx) ctx.close().catch(() => {});
      ctx = null;
    },
  };
}
