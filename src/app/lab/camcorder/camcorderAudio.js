export function createCamSound() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: "interactive" });
  const length = Math.floor(ctx.sampleRate * 2);
  const noise = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = noise.getChannelData(0);
  let seed = 7771;
  for (let i = 0; i < length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    data[i] = (seed / 4294967296) * 2 - 1;
  }
  const master = ctx.createGain();
  master.gain.value = 0.85;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.15;
  master.connect(comp);
  comp.connect(ctx.destination);

  let enabled = false;
  let bed = null;
  let voice = 0;
  const last = { zoom: -1, tape: -1, hiss: -1 };

  const burst = ({ at, type = "bandpass", freq, q = 1, gain, attack = 0.001, decay }) => {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    s.connect(f);
    f.connect(env);
    env.connect(master);
    voice = (voice + 1) % 83;
    s.start(at, (voice * 0.0191) % 1.7, attack + decay + 0.02);
    s.onended = () => env.disconnect();
  };

  const tone = (at, freq, dur, gain) => {
    const o = ctx.createOscillator();
    o.type = "square";
    o.frequency.value = freq;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 5200;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(gain, at + 0.004);
    env.gain.setValueAtTime(gain, at + dur - 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    o.connect(lp);
    lp.connect(env);
    env.connect(master);
    o.start(at);
    o.stop(at + dur + 0.02);
    o.onended = () => env.disconnect();
  };

  const startBed = () => {
    if (bed) return;
    const motor = ctx.createOscillator();
    motor.type = "sawtooth";
    motor.frequency.value = 210;
    const motorBand = ctx.createBiquadFilter();
    motorBand.type = "bandpass";
    motorBand.frequency.value = 1400;
    motorBand.Q.value = 1.2;
    const motorNoise = ctx.createBufferSource();
    motorNoise.buffer = noise;
    motorNoise.loop = true;
    const motorNoiseBand = ctx.createBiquadFilter();
    motorNoiseBand.type = "bandpass";
    motorNoiseBand.frequency.value = 2600;
    motorNoiseBand.Q.value = 2;
    const zoomGain = ctx.createGain();
    zoomGain.gain.value = 0;
    motor.connect(motorBand);
    motorBand.connect(zoomGain);
    motorNoise.connect(motorNoiseBand);
    motorNoiseBand.connect(zoomGain);
    zoomGain.connect(master);

    const tapeNoise = ctx.createBufferSource();
    tapeNoise.buffer = noise;
    tapeNoise.loop = true;
    const tapeLp = ctx.createBiquadFilter();
    tapeLp.type = "lowpass";
    tapeLp.frequency.value = 420;
    const tapeHum = ctx.createOscillator();
    tapeHum.frequency.value = 93;
    const tapeHumGain = ctx.createGain();
    tapeHumGain.gain.value = 0.4;
    const tapeGain = ctx.createGain();
    tapeGain.gain.value = 0;
    tapeNoise.connect(tapeLp);
    tapeLp.connect(tapeGain);
    tapeHum.connect(tapeHumGain);
    tapeHumGain.connect(tapeGain);
    tapeGain.connect(master);

    const hissSrc = ctx.createBufferSource();
    hissSrc.buffer = noise;
    hissSrc.loop = true;
    const hissHp = ctx.createBiquadFilter();
    hissHp.type = "highpass";
    hissHp.frequency.value = 1800;
    const hissGain = ctx.createGain();
    hissGain.gain.value = 0;
    hissSrc.connect(hissHp);
    hissHp.connect(hissGain);
    hissGain.connect(master);

    motor.start();
    motorNoise.start(0, 0.3);
    tapeNoise.start(0, 0.9);
    tapeHum.start();
    hissSrc.start(0, 1.4);
    bed = { motor, motorNoise, tapeNoise, tapeHum, hissSrc, zoomGain, tapeGain, hissGain, motorBand };
  };

  const stopBed = () => {
    if (!bed) return;
    const t = ctx.currentTime + 0.05;
    bed.motor.stop(t);
    bed.motorNoise.stop(t);
    bed.tapeNoise.stop(t);
    bed.tapeHum.stop(t);
    bed.hissSrc.stop(t);
    bed = null;
    last.zoom = -1;
    last.tape = -1;
    last.hiss = -1;
  };

  const live = () => enabled && ctx.state === "running";

  return {
    async setEnabled(on) {
      enabled = on;
      if (on) {
        if (ctx.state !== "running") await ctx.resume().catch(() => {});
        if (ctx.state !== "running") return false;
        startBed();
        return true;
      }
      stopBed();
      if (ctx.state === "running") await ctx.suspend().catch(() => {});
      return false;
    },
    beep(count) {
      if (!live()) return;
      const t = ctx.currentTime + 0.01;
      for (let i = 0; i < count; i += 1) tone(t + i * 0.13, 2640, 0.075, 0.07);
    },
    clunk() {
      if (!live()) return;
      const t = ctx.currentTime;
      burst({ at: t, type: "lowpass", freq: 260, q: 1.2, gain: 0.3, attack: 0.002, decay: 0.07 });
      burst({ at: t + 0.004, freq: 2400, q: 1.6, gain: 0.12, attack: 0.0008, decay: 0.014 });
      burst({ at: t + 0.06, freq: 1300, q: 2, gain: 0.07, attack: 0.001, decay: 0.02 });
    },
    focusTick() {
      if (!live()) return;
      const t = ctx.currentTime;
      burst({ at: t, freq: 5200, q: 3, gain: 0.025, attack: 0.0006, decay: 0.006 });
    },
    update({ zoom, tape, hiss }) {
      if (!live() || !bed) return;
      const t = ctx.currentTime;
      const z = Math.round(zoom * 50) / 50;
      if (z !== last.zoom) {
        bed.zoomGain.gain.setTargetAtTime(Math.min(1, z) * 0.06, t, 0.03);
        bed.motor.frequency.setTargetAtTime(170 + z * 90, t, 0.05);
        bed.motorBand.frequency.setTargetAtTime(1100 + z * 700, t, 0.05);
        last.zoom = z;
      }
      const tp = tape ? 1 : 0;
      if (tp !== last.tape) {
        bed.tapeGain.gain.setTargetAtTime(tp * 0.05, t, 0.08);
        last.tape = tp;
      }
      const h = Math.round(hiss * 40) / 40;
      if (h !== last.hiss) {
        bed.hissGain.gain.setTargetAtTime(h * 0.12, t, 0.03);
        last.hiss = h;
      }
    },
    destroy() {
      enabled = false;
      ctx.close().catch(() => {});
    },
  };
}
