export function createScannerAudio() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: "interactive" });
  const length = Math.floor(ctx.sampleRate * 1.2);
  const noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  let seed = 991;
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 4294967296) * 2 - 1;
  }
  const master = ctx.createGain();
  master.gain.value = 0.9;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.ratio.value = 5;
  comp.attack.value = 0.002;
  comp.release.value = 0.14;
  master.connect(comp);
  comp.connect(ctx.destination);
  let enabled = false;
  let voice = 0;
  let motor = null;

  const live = () => enabled && ctx.state === "running";

  const pan = (value) => {
    if (!ctx.createStereoPanner) return master;
    const p = ctx.createStereoPanner();
    p.pan.value = Math.max(-0.8, Math.min(0.8, value));
    p.connect(master);
    return p;
  };

  const burst = ({ at = 0, freq, q = 1.2, type = "bandpass", gain, attack = 0.001, decay, out }) => {
    const now = ctx.currentTime + at;
    voice = (voice + 1) % 97;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq * (0.95 + ((voice * 37) % 11) / 100);
    f.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(gain, now + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, now + attack + decay);
    src.connect(f);
    f.connect(env);
    env.connect(out || master);
    src.start(now, ((voice * 0.0191) % 1) + 0.01, attack + decay + 0.05);
    src.onended = () => env.disconnect();
  };

  function ensureMotor() {
    if (motor) return motor;
    const out = ctx.createGain();
    out.gain.value = 0.0001;
    out.connect(master);
    const step = ctx.createOscillator();
    step.type = "square";
    step.frequency.value = 90;
    const body = ctx.createBiquadFilter();
    body.type = "bandpass";
    body.frequency.value = 700;
    body.Q.value = 2.4;
    const hum = ctx.createOscillator();
    hum.type = "sawtooth";
    hum.frequency.value = 180;
    const humLp = ctx.createBiquadFilter();
    humLp.type = "lowpass";
    humLp.frequency.value = 900;
    const humGain = ctx.createGain();
    humGain.gain.value = 0.35;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 36;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.4;
    const am = ctx.createGain();
    am.gain.value = 0.6;
    lfo.connect(lfoGain);
    lfoGain.connect(am.gain);
    step.connect(body);
    body.connect(am);
    hum.connect(humLp);
    humLp.connect(humGain);
    humGain.connect(am);
    am.connect(out);
    step.start();
    hum.start();
    lfo.start();
    motor = { out, step, hum, lfo, body };
    return motor;
  }

  return {
    async setEnabled(on) {
      enabled = on;
      if (on && ctx.state !== "running") await ctx.resume().catch(() => {});
      if (!on) {
        this.motor(0);
        if (ctx.state === "running") await ctx.suspend().catch(() => {});
      }
      return enabled && ctx.state === "running";
    },
    lamp() {
      if (!live()) return;
      burst({ freq: 3400, q: 2, gain: 0.12, decay: 0.012 });
      burst({ at: 0.004, freq: 600, q: 2, gain: 0.06, decay: 0.04 });
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.frequency.value = 9800;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(0.004, now + 0.1);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
      osc.connect(g);
      g.connect(master);
      osc.start(now);
      osc.stop(now + 1);
      osc.onended = () => g.disconnect();
    },
    motor(level) {
      const now = ctx.currentTime;
      if (!live()) {
        if (motor) motor.out.gain.setTargetAtTime(0.0001, now, 0.02);
        return;
      }
      const m = ensureMotor();
      const l = Math.max(0, Math.min(1, level));
      m.out.gain.setTargetAtTime(l > 0.01 ? 0.02 + l * 0.05 : 0.0001, now, 0.05);
      m.step.frequency.setTargetAtTime(70 + l * 160, now, 0.06);
      m.hum.frequency.setTargetAtTime(150 + l * 260, now, 0.06);
      m.lfo.frequency.setTargetAtTime(24 + l * 60, now, 0.06);
      m.body.frequency.setTargetAtTime(600 + l * 700, now, 0.06);
    },
    done() {
      if (!live()) return;
      burst({ freq: 240, q: 1.6, gain: 0.14, decay: 0.08 });
      burst({ at: 0.012, freq: 1900, q: 2, gain: 0.06, decay: 0.02 });
    },
    lift(paper) {
      if (!live()) return;
      burst({ freq: paper ? 2600 : 1400, q: 0.8, gain: paper ? 0.03 : 0.04, attack: 0.02, decay: 0.12 });
    },
    drop(level = 1, x = 0) {
      if (!live()) return;
      const out = pan(x);
      burst({ freq: 900, q: 0.9, type: "lowpass", gain: 0.12 * level, decay: 0.05, out });
      burst({ at: 0.002, freq: 3800, q: 1.2, gain: 0.04 * level, decay: 0.03, out });
    },
    destroy() {
      enabled = false;
      ctx.close().catch(() => {});
    },
  };
}
