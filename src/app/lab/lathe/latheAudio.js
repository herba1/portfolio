function makeNoise(ctx) {
  const length = Math.floor(ctx.sampleRate * 2);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const ch = buffer.getChannelData(0);
  let seed = 1234567;
  const rand = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) >>> 0;
    return seed / 4294967296;
  };
  let b0 = 0;
  let b1 = 0;
  for (let i = 0; i < length; i++) {
    const white = rand() * 2 - 1;
    b0 = 0.97 * b0 + white * 0.15;
    b1 = 0.6 * b1 + white * 0.4;
    let v = (b0 + b1) * 0.5;
    if (rand() < 0.00035) {
      const amp = 0.6 + rand() * 1.4;
      const len = 8 + Math.floor(rand() * 30);
      for (let j = 0; j < len && i + j < length; j++) ch[i + j] += amp * Math.exp(-j / 5) * (j % 2 ? -1 : 1);
    }
    ch[i] += v;
  }
  return buffer;
}

function makeCurve() {
  const curve = new Float32Array(1024);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * 1.6) / Math.tanh(1.6);
  }
  return curve;
}

export function createLatheAudio() {
  let ctx = null;
  let master = null;
  let voice = null;
  let tone = null;
  let overtone = null;
  let filter = null;
  let hiss = null;
  let hissFilter = null;
  let noise = null;
  let muted = false;
  let running = false;

  function start() {
    if (ctx) {
      wake();
      return true;
    }
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return false;
    ctx = new Ctx({ latencyHint: "interactive" });
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);
    const shaper = ctx.createWaveShaper();
    shaper.curve = makeCurve();
    filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2200;
    filter.Q.value = 0.4;
    voice = ctx.createGain();
    voice.gain.value = 0;
    tone = ctx.createOscillator();
    tone.type = "sine";
    tone.frequency.value = 220;
    overtone = ctx.createOscillator();
    overtone.type = "triangle";
    overtone.frequency.value = 440;
    const overGain = ctx.createGain();
    overGain.gain.value = 0.16;
    tone.connect(shaper);
    overtone.connect(overGain).connect(shaper);
    shaper.connect(filter).connect(voice).connect(master);
    noise = ctx.createBufferSource();
    noise.buffer = makeNoise(ctx);
    noise.loop = true;
    hissFilter = ctx.createBiquadFilter();
    hissFilter.type = "bandpass";
    hissFilter.frequency.value = 2400;
    hissFilter.Q.value = 0.6;
    hiss = ctx.createGain();
    hiss.gain.value = 0;
    noise.connect(hissFilter).connect(hiss).connect(master);
    tone.start();
    overtone.start();
    noise.start();
    running = true;
    ctx.resume().catch(() => {});
    return true;
  }

  function update({ freq, amp, noiseAmp, noiseFreq }) {
    if (!ctx || !running) return;
    const t = ctx.currentTime;
    tone.frequency.setTargetAtTime(freq, t, 0.012);
    overtone.frequency.setTargetAtTime(freq * 2, t, 0.012);
    voice.gain.setTargetAtTime(amp * 0.32, t, 0.018);
    hiss.gain.setTargetAtTime(noiseAmp * 0.12, t, 0.03);
    hissFilter.frequency.setTargetAtTime(noiseFreq, t, 0.05);
    filter.frequency.setTargetAtTime(1200 + amp * 2400, t, 0.03);
  }

  function setMuted(next) {
    muted = next;
    if (!ctx) return;
    master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.02);
  }

  function sleep() {
    if (!ctx || !running) return;
    running = false;
    const t = ctx.currentTime;
    voice.gain.cancelScheduledValues(t);
    hiss.gain.cancelScheduledValues(t);
    voice.gain.setValueAtTime(0, t);
    hiss.gain.setValueAtTime(0, t);
    ctx.suspend().catch(() => {});
  }

  function wake() {
    if (!ctx || running) return;
    running = true;
    ctx.resume().catch(() => {});
  }

  function destroy() {
    if (ctx) ctx.close().catch(() => {});
    ctx = null;
  }

  return {
    start,
    update,
    setMuted,
    sleep,
    wake,
    destroy,
    get started() {
      return Boolean(ctx);
    },
  };
}
