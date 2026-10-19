export function createBurnAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: "interactive" });
  const length = Math.floor(ctx.sampleRate * 1.2);
  const noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  let seed = 4421;
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 4294967296) * 2 - 1;
  }
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 10;
  comp.ratio.value = 5;
  comp.attack.value = 0.002;
  comp.release.value = 0.14;
  master.connect(comp);
  comp.connect(ctx.destination);
  let enabled = false;
  let voice = 0;
  let motor = null;
  let friction = null;

  const pan = (value) => {
    if (!ctx.createStereoPanner) return master;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-0.9, Math.min(0.9, value));
    p.connect(master);
    return p;
  };

  const burst = ({ at = 0, freq, q = 1.2, type = "bandpass", gain, attack = 0.001, decay, out, high = 0 }) => {
    const now = ctx.currentTime + at;
    voice = (voice + 1) % 113;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq * (0.94 + ((voice * 37) % 13) / 100);
    f.Q.value = q;
    let tail = f;
    if (high) {
      const h = ctx.createBiquadFilter();
      h.type = "highpass";
      h.frequency.value = high;
      f.connect(h);
      tail = h;
    }
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(gain, now + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
    src.connect(f);
    tail.connect(env);
    env.connect(out || master);
    src.start(now, ((voice * 0.0173) % 1) + 0.01, attack + decay + 0.05);
    src.onended = () => env.disconnect();
  };

  const tone = ({ at = 0, freq, to, gain, decay, type = "sine", out }) => {
    const now = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, now + decay);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(gain, now + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, now + decay);
    osc.connect(env);
    env.connect(out || master);
    osc.start(now);
    osc.stop(now + decay + 0.05);
    osc.onended = () => env.disconnect();
  };

  const live = () => enabled && ctx.state === "running";

  return {
    get enabled() {
      return enabled;
    },
    async setEnabled(on) {
      enabled = on;
      if (on && ctx.state !== "running") await ctx.resume().catch(() => {});
      if (!on) {
        this.motorStop(true);
        this.marker(0);
        if (ctx.state === "running") await ctx.suspend().catch(() => {});
      }
      return enabled && ctx.state === "running";
    },
    tap(x = 0, level = 1) {
      if (!live()) return;
      const out = pan(x);
      burst({ freq: 2400, q: 1.4, gain: 0.16 * level, decay: 0.018, out, high: 900 });
      burst({ at: 0.002, freq: 420, q: 2.4, gain: 0.12 * level, decay: 0.05, out });
    },
    seat(x = 0) {
      if (!live()) return;
      const out = pan(x);
      burst({ freq: 3200, q: 2.2, gain: 0.16, decay: 0.012, out, high: 1500 });
      burst({ at: 0.03, freq: 2600, q: 2.6, gain: 0.1, decay: 0.01, out, high: 1500 });
      burst({ at: 0.004, freq: 360, q: 2, gain: 0.12, decay: 0.07, out });
    },
    lidOpen(x = 0) {
      if (!live()) return;
      const out = pan(x);
      burst({ freq: 3600, q: 1.8, gain: 0.2, decay: 0.01, out, high: 2000 });
      burst({ at: 0.004, freq: 900, q: 1.2, gain: 0.1, decay: 0.05, out });
      burst({ at: 0.03, freq: 1400, q: 0.7, gain: 0.03, attack: 0.05, decay: 0.16, out });
      tone({ at: 0.006, freq: 1900, to: 1700, gain: 0.012, decay: 0.12, type: "triangle", out });
    },
    lidClose(x = 0) {
      if (!live()) return;
      const out = pan(x);
      burst({ freq: 260, q: 1.6, gain: 0.22, decay: 0.07, out });
      burst({ at: 0.001, freq: 1800, q: 1.4, gain: 0.12, decay: 0.02, out, high: 700 });
      burst({ at: 0.028, freq: 4200, q: 2.4, gain: 0.16, decay: 0.008, out, high: 2500 });
      burst({ at: 0.03, freq: 700, q: 2, gain: 0.06, decay: 0.03, out });
    },
    button(x = 0) {
      if (!live()) return;
      const out = pan(x);
      burst({ freq: 3000, q: 2, gain: 0.08, decay: 0.008, out, high: 1500 });
      burst({ at: 0.05, freq: 2400, q: 2, gain: 0.05, decay: 0.008, out, high: 1500 });
    },
    whoosh(x = 0) {
      if (!live()) return;
      const out = pan(x);
      const now = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = 0.8;
      f.frequency.setValueAtTime(500, now);
      f.frequency.exponentialRampToValueAtTime(1800, now + 0.16);
      f.frequency.exponentialRampToValueAtTime(700, now + 0.32);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, now);
      env.gain.exponentialRampToValueAtTime(0.05, now + 0.12);
      env.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);
      src.connect(f);
      f.connect(env);
      env.connect(out);
      src.start(now, 0.2, 0.4);
      src.onended = () => env.disconnect();
    },
    seek(count = 3) {
      if (!live()) return;
      for (let i = 0; i < count; i += 1) {
        const at = i * 0.07 + (i % 2) * 0.012;
        tone({ at, freq: 1500 + (i % 3) * 140, gain: 0.018, decay: 0.022, type: "square" });
        burst({ at, freq: 5200, q: 3, gain: 0.03, decay: 0.006, high: 3000 });
      }
    },
    sled() {
      if (!live()) return;
      for (let i = 0; i < 9; i += 1) burst({ at: i * 0.022, freq: 1700 + (i % 4) * 300, q: 4, gain: 0.04, decay: 0.012, high: 900 });
    },
    motorStart(rate = 1) {
      if (!live()) return;
      const now = ctx.currentTime;
      if (!motor) {
        const out = ctx.createGain();
        out.gain.value = 0.0001;
        out.connect(master);
        const osc = ctx.createOscillator();
        osc.type = "sawtooth";
        const lp = ctx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 1400;
        lp.Q.value = 0.9;
        const whine = ctx.createOscillator();
        whine.type = "sine";
        const wg = ctx.createGain();
        wg.gain.value = 0.35;
        const air = ctx.createBufferSource();
        air.buffer = noise;
        air.loop = true;
        const af = ctx.createBiquadFilter();
        af.type = "bandpass";
        af.Q.value = 0.7;
        af.frequency.value = 600;
        const ag = ctx.createGain();
        ag.gain.value = 0.5;
        osc.connect(lp);
        lp.connect(out);
        whine.connect(wg);
        wg.connect(out);
        air.connect(af);
        af.connect(ag);
        ag.connect(out);
        osc.frequency.value = 30;
        whine.frequency.value = 60;
        osc.start();
        whine.start();
        air.start();
        motor = { out, osc, whine, air, af };
      }
      const { out, osc, whine, af } = motor;
      for (const p of [out.gain, osc.frequency, whine.frequency, af.frequency]) p.cancelScheduledValues(now);
      out.gain.setValueAtTime(Math.max(out.gain.value, 0.0001), now);
      out.gain.exponentialRampToValueAtTime(0.045 * rate, now + 0.25);
      out.gain.exponentialRampToValueAtTime(0.018 * rate, now + 1.6);
      osc.frequency.setValueAtTime(Math.max(osc.frequency.value, 30), now);
      osc.frequency.exponentialRampToValueAtTime(110 * rate, now + 1.1);
      whine.frequency.setValueAtTime(Math.max(whine.frequency.value, 60), now);
      whine.frequency.exponentialRampToValueAtTime(1180 * rate, now + 1.15);
      whine.frequency.exponentialRampToValueAtTime(1060 * rate, now + 1.6);
      af.frequency.setValueAtTime(Math.max(af.frequency.value, 200), now);
      af.frequency.exponentialRampToValueAtTime(2400 * rate, now + 1.2);
    },
    motorStop(hard = false) {
      if (!motor) return;
      const now = ctx.currentTime;
      const { out, osc, whine, air, af } = motor;
      const span = hard ? 0.05 : 1.4;
      for (const p of [out.gain, osc.frequency, whine.frequency, af.frequency]) p.cancelScheduledValues(now);
      out.gain.setValueAtTime(Math.max(out.gain.value, 0.0001), now);
      out.gain.exponentialRampToValueAtTime(0.0001, now + span);
      osc.frequency.setValueAtTime(Math.max(osc.frequency.value, 30), now);
      osc.frequency.exponentialRampToValueAtTime(30, now + span);
      whine.frequency.setValueAtTime(Math.max(whine.frequency.value, 60), now);
      whine.frequency.exponentialRampToValueAtTime(60, now + span);
      af.frequency.setValueAtTime(Math.max(af.frequency.value, 200), now);
      af.frequency.exponentialRampToValueAtTime(200, now + span);
      const m = motor;
      motor = null;
      setTimeout(() => {
        m.osc.stop();
        m.whine.stop();
        air.stop();
        m.out.disconnect();
      }, span * 1000 + 120);
    },
    marker(speed) {
      if (!live() && speed > 0) return;
      const now = ctx.currentTime;
      if (!friction && speed > 0.001) {
        const src = ctx.createBufferSource();
        src.buffer = noise;
        src.loop = true;
        const f = ctx.createBiquadFilter();
        f.type = "bandpass";
        f.frequency.value = 2600;
        f.Q.value = 3.2;
        const felt = ctx.createBiquadFilter();
        felt.type = "highpass";
        felt.frequency.value = 900;
        const g = ctx.createGain();
        g.gain.value = 0.0001;
        const squeak = ctx.createOscillator();
        squeak.type = "triangle";
        squeak.frequency.value = 1900;
        const sg = ctx.createGain();
        sg.gain.value = 0.0001;
        src.connect(f);
        f.connect(felt);
        felt.connect(g);
        g.connect(master);
        squeak.connect(sg);
        sg.connect(master);
        src.start();
        squeak.start();
        friction = { src, f, g, squeak, sg };
      }
      if (!friction) return;
      const level = Math.max(0, Math.min(1, speed));
      friction.g.gain.setTargetAtTime(Math.max(0.0001, level * 0.07), now, 0.02);
      friction.f.frequency.setTargetAtTime(2000 + level * 2600, now, 0.03);
      friction.sg.gain.setTargetAtTime(Math.max(0.0001, level > 0.25 ? (level - 0.25) * 0.012 : 0.0001), now, 0.03);
      friction.squeak.frequency.setTargetAtTime(1700 + level * 900, now, 0.04);
    },
    cap(x = 0) {
      if (!live()) return;
      const out = pan(x);
      burst({ freq: 1200, q: 2.4, gain: 0.08, decay: 0.03, out });
      burst({ at: 0.01, freq: 4200, q: 1.6, gain: 0.06, decay: 0.01, out, high: 2000 });
    },
    destroy() {
      enabled = false;
      ctx.close().catch(() => {});
    },
  };
}
