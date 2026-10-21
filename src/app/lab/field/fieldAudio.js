const CHORDS = [
  [220, 277.18, 329.63, 440],
  [196, 246.94, 293.66, 392],
  [174.61, 220, 261.63, 349.23],
  [164.81, 207.65, 246.94, 329.63],
];

function noiseBuffer(ctx, seconds, seed) {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let s = seed;
  let brown = 0;
  for (let i = 0; i < length; i += 1) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const white = (s / 4294967296) * 2 - 1;
    brown = (brown + white * 0.09) * 0.985;
    data[i] = white * 0.35 + brown * 2.2;
  }
  const fade = Math.floor(ctx.sampleRate * 0.12);
  for (let i = 0; i < fade; i += 1) {
    const k = i / fade;
    data[i] = data[i] * k + data[length - fade + i] * (1 - k);
  }
  buffer.loopTail = (length - fade) / ctx.sampleRate;
  return buffer;
}

export function createFieldSound() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: "playback" });
  const master = ctx.createGain();
  master.gain.value = 0;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 12;
  comp.ratio.value = 3;
  comp.attack.value = 0.02;
  comp.release.value = 0.4;
  const air = ctx.createBiquadFilter();
  air.type = "lowpass";
  air.frequency.value = 900;
  air.Q.value = 0.4;
  const floor = ctx.createBiquadFilter();
  floor.type = "highpass";
  floor.frequency.value = 70;
  air.connect(floor);
  floor.connect(master);
  master.connect(comp);
  comp.connect(ctx.destination);

  const sides = [-0.6, 0.6].map((pan, k) => {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx, 5.3 + k * 0.9, 1234 + k * 777);
    src.loop = true;
    src.loopEnd = src.buffer.loopTail;
    const body = ctx.createBiquadFilter();
    body.type = "bandpass";
    body.frequency.value = 380;
    body.Q.value = 0.55;
    const whistle = ctx.createBiquadFilter();
    whistle.type = "bandpass";
    whistle.frequency.value = 820 + k * 210;
    whistle.Q.value = 7;
    const bodyGain = ctx.createGain();
    bodyGain.gain.value = 0.5;
    const whistleGain = ctx.createGain();
    whistleGain.gain.value = 0.0;
    const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (panner.pan) panner.pan.value = pan;
    src.connect(body);
    body.connect(bodyGain);
    bodyGain.connect(panner);
    src.connect(whistle);
    whistle.connect(whistleGain);
    whistleGain.connect(panner);
    panner.connect(air);
    return { src, body, whistle, bodyGain, whistleGain };
  });

  const chordBus = ctx.createGain();
  chordBus.gain.value = 0;
  chordBus.connect(floor);
  const chordSrc = ctx.createBufferSource();
  chordSrc.buffer = noiseBuffer(ctx, 4.7, 4242);
  chordSrc.loop = true;
  chordSrc.loopEnd = chordSrc.buffer.loopTail;
  const voices = CHORDS[0].map((f, k) => {
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = f;
    bp.Q.value = 60;
    const g = ctx.createGain();
    g.gain.value = [1, 0.7, 0.6, 0.4][k] * 5;
    chordSrc.connect(bp);
    bp.connect(g);
    g.connect(chordBus);
    return bp;
  });

  let started = false;
  let enabled = false;
  let gust = 0;
  let gustTarget = 0;
  let gustAt = 0;
  let chordIndex = 0;

  const ramp = (param, value, tau) => {
    param.setTargetAtTime(value, ctx.currentTime, tau);
  };

  return {
    async setEnabled(on) {
      enabled = on;
      if (on) {
        const resumed = ctx.state === "running" ? Promise.resolve() : ctx.resume().catch(() => {});
        if (!started) {
          started = true;
          const t = ctx.currentTime + 0.02;
          sides.forEach((s) => s.src.start(t));
          chordSrc.start(t);
        }
        await resumed;
        if (ctx.state !== "running" || !enabled) return false;
        master.gain.cancelScheduledValues(ctx.currentTime);
        master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
        master.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 0.8);
        return true;
      }
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(master.gain.value, ctx.currentTime);
      master.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.25);
      await new Promise((r) => setTimeout(r, 300));
      if (!enabled && ctx.state === "running") await ctx.suspend().catch(() => {});
      return false;
    },
    chord(i) {
      chordIndex = i % CHORDS.length;
      const now = ctx.currentTime;
      CHORDS[chordIndex].forEach((f, k) => voices[k].frequency.setTargetAtTime(f, now, 0.05));
    },
    update({ swell, hold, stir, clock }) {
      if (!enabled || ctx.state !== "running") return;
      if (clock > gustAt) {
        gustAt = clock + 0.8 + Math.random() * 1.6;
        gustTarget = Math.random();
      }
      gust += (gustTarget - gust) * 0.02;
      const s = Math.min(1, swell * 0.85 + stir * 0.6 + gust * 0.18);
      ramp(air.frequency, 520 + 2600 * s * s + 300 * gust, 0.25);
      sides.forEach((side, k) => {
        ramp(side.bodyGain.gain, 0.16 + 0.62 * s, 0.3);
        ramp(side.body.frequency, 260 + 520 * s + 80 * gust * (k ? 1 : -1), 0.4);
        ramp(side.whistleGain.gain, 0.02 + 0.22 * s * s + 0.05 * stir, 0.35);
        ramp(side.whistle.frequency, 640 + 900 * s + k * 230 + 160 * gust, 0.6);
      });
      ramp(chordBus.gain, 0.28 * hold, 0.5);
    },
    destroy() {
      enabled = false;
      try {
        sides.forEach((s) => s.src.stop());
        chordSrc.stop();
      } catch {}
      ctx.close().catch(() => {});
    },
  };
}
