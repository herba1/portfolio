export function createRisoSound() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: "interactive" });
  const length = Math.floor(ctx.sampleRate * 2.0);
  const noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  let seed = 771177;
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 4294967296) * 2 - 1;
  }
  const master = ctx.createGain();
  master.gain.value = 0.85;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -20;
  comp.knee.value = 12;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.2;
  master.connect(comp);
  comp.connect(ctx.destination);

  let enabled = false;
  let voice = 0;
  let lastTick = 0;
  const running = new Set();

  const track = (node, end) => {
    running.add(node);
    node.onended = () => {
      running.delete(node);
      end?.();
    };
  };

  const burst = ({ at, type = "bandpass", freq, q = 1, gain, attack = 0.001, decay = 0.04, pan = 0 }) => {
    voice = (voice + 1) % 997;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    src.connect(f);
    f.connect(env);
    let out = env;
    if (ctx.createStereoPanner && pan) {
      out = ctx.createStereoPanner();
      out.pan.value = pan;
      env.connect(out);
    }
    out.connect(master);
    src.start(at, ((voice * 0.0371) % 1.6) + 0.01, attack + decay + 0.03);
    track(src, () => out.disconnect());
  };

  const thump = (at, from, to, gain, decay) => {
    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(from, at);
    osc.frequency.exponentialRampToValueAtTime(to, at + decay);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    osc.connect(env);
    env.connect(master);
    osc.start(at);
    osc.stop(at + decay + 0.03);
    track(osc, () => env.disconnect());
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
    feed() {
      if (!live()) return;
      const at = ctx.currentTime + 0.005;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.Q.value = 0.8;
      f.frequency.setValueAtTime(1800, at);
      f.frequency.exponentialRampToValueAtTime(4200, at + 0.3);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, at);
      env.gain.exponentialRampToValueAtTime(0.07, at + 0.08);
      env.gain.exponentialRampToValueAtTime(0.0001, at + 0.36);
      src.connect(f);
      f.connect(env);
      env.connect(master);
      src.start(at, 0.2, 0.4);
      track(src, () => env.disconnect());
      burst({ at: at + 0.34, freq: 900, q: 1.4, gain: 0.08, decay: 0.05 });
      thump(at + 0.34, 120, 70, 0.12, 0.09);
    },
    drum(duration, index) {
      if (!live()) return;
      const at = ctx.currentTime + 0.005;
      const end = at + duration;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      src.loop = true;
      const low = ctx.createBiquadFilter();
      low.type = "lowpass";
      low.frequency.value = 260 + index * 30;
      low.Q.value = 0.9;
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, at);
      env.gain.exponentialRampToValueAtTime(0.32, at + 0.08);
      env.gain.setValueAtTime(0.32, end - 0.12);
      env.gain.exponentialRampToValueAtTime(0.0001, end);
      const wobble = ctx.createGain();
      wobble.gain.value = 0.7;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 7.2;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.3;
      lfo.connect(lfoGain);
      lfoGain.connect(wobble.gain);
      src.connect(low);
      low.connect(wobble);
      wobble.connect(env);
      env.connect(master);
      const motor = ctx.createOscillator();
      motor.type = "sawtooth";
      motor.frequency.setValueAtTime(92, at);
      motor.frequency.linearRampToValueAtTime(104, at + 0.2);
      const motorLp = ctx.createBiquadFilter();
      motorLp.type = "lowpass";
      motorLp.frequency.value = 420;
      const motorEnv = ctx.createGain();
      motorEnv.gain.setValueAtTime(0.0001, at);
      motorEnv.gain.exponentialRampToValueAtTime(0.022, at + 0.12);
      motorEnv.gain.setValueAtTime(0.022, end - 0.12);
      motorEnv.gain.exponentialRampToValueAtTime(0.0001, end);
      motor.connect(motorLp);
      motorLp.connect(motorEnv);
      motorEnv.connect(master);
      src.start(at, (index * 0.31) % 1.5);
      src.stop(end + 0.02);
      lfo.start(at);
      lfo.stop(end + 0.02);
      motor.start(at);
      motor.stop(end + 0.02);
      track(src, () => {
        env.disconnect();
        wobble.disconnect();
        low.disconnect();
      });
      track(motor, () => motorEnv.disconnect());
      track(lfo, () => lfoGain.disconnect());
      const beats = Math.floor(duration * 7.2);
      for (let b = 0; b < beats; b += 1) {
        burst({ at: at + 0.05 + b / 7.2, freq: 1300 + (b % 3) * 140, q: 2.2, gain: 0.035, decay: 0.03 });
      }
      burst({ at, freq: 2600, q: 0.7, gain: 0.05, decay: 0.12 });
      burst({ at: end - 0.04, freq: 700, q: 1.2, gain: 0.1, decay: 0.06 });
      thump(end - 0.04, 150, 80, 0.14, 0.1);
    },
    tick(pan) {
      if (!live()) return;
      const now = ctx.currentTime;
      if (now - lastTick < 0.03) return;
      lastTick = now;
      burst({ at: now + 0.002, freq: 3600, q: 5, gain: 0.07, decay: 0.012, pan });
      burst({ at: now + 0.004, freq: 1200, q: 2, gain: 0.03, decay: 0.02, pan });
    },
    stopAll() {
      for (const node of running) {
        try {
          node.stop();
        } catch {
          running.delete(node);
        }
      }
    },
    destroy() {
      enabled = false;
      ctx.close().catch(() => {});
    },
  };
}
