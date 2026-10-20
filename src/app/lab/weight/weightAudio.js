const NOTES = [
  { f: 73.42, type: "sawtooth", g: 0.16, d: -7 },
  { f: 73.42, type: "sawtooth", g: 0.16, d: 6 },
  { f: 110.0, type: "sawtooth", g: 0.11, d: 3 },
  { f: 146.83, type: "triangle", g: 0.12, d: -4 },
  { f: 164.81, type: "sine", g: 0.07, d: 0 },
  { f: 220.0, type: "triangle", g: 0.05, d: 5 },
];

export function createWeightSound() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  const ctx = new Ctx({ latencyHint: "playback" });
  const rate = ctx.sampleRate;
  const noise = ctx.createBuffer(1, Math.floor(rate * 2), rate);
  const nd = noise.getChannelData(0);
  let seed = 90127;
  for (let i = 0; i < nd.length; i += 1) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    nd[i] = (seed / 4294967296) * 2 - 1;
  }

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18;
  comp.knee.value = 12;
  comp.ratio.value = 3;
  comp.attack.value = 0.02;
  comp.release.value = 0.3;
  comp.connect(ctx.destination);
  const master = ctx.createGain();
  master.gain.value = 0.0001;
  master.connect(comp);

  const irLen = Math.floor(rate * 3.2);
  const ir = ctx.createBuffer(2, irLen, rate);
  for (let c = 0; c < 2; c += 1) {
    const d = ir.getChannelData(c);
    let s = 1301 + c * 7717;
    for (let i = 0; i < irLen; i += 1) {
      s = (s * 1664525 + 1013904223) >>> 0;
      const t = i / irLen;
      d[i] = ((s / 4294967296) * 2 - 1) * (1 - t) ** 3.2 * 0.5;
    }
  }
  const verb = ctx.createConvolver();
  verb.buffer = ir;
  const wet = ctx.createGain();
  wet.gain.value = 0.42;
  verb.connect(wet);
  wet.connect(master);

  const tone = ctx.createBiquadFilter();
  tone.type = "lowpass";
  tone.frequency.value = 260;
  tone.Q.value = 1.1;
  const body = ctx.createGain();
  body.gain.value = 0.5;
  tone.connect(body);
  body.connect(master);
  body.connect(verb);

  const oscs = NOTES.map((n) => {
    const o = ctx.createOscillator();
    o.type = n.type;
    o.frequency.value = n.f;
    o.detune.value = n.d;
    const g = ctx.createGain();
    g.gain.value = n.g;
    o.connect(g);
    g.connect(tone);
    o.start();
    return o;
  });

  const lfo = ctx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoGain = ctx.createGain();
  lfoGain.gain.value = 6;
  lfo.connect(lfoGain);
  oscs.forEach((o) => lfoGain.connect(o.detune));
  lfo.start();

  const air = ctx.createBufferSource();
  air.buffer = noise;
  air.loop = true;
  const airBand = ctx.createBiquadFilter();
  airBand.type = "bandpass";
  airBand.frequency.value = 900;
  airBand.Q.value = 0.7;
  const airGain = ctx.createGain();
  airGain.gain.value = 0.0001;
  const airPan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
  air.connect(airBand);
  airBand.connect(airGain);
  if (airPan) {
    airGain.connect(airPan);
    airPan.connect(master);
    airPan.connect(verb);
  } else {
    airGain.connect(master);
  }
  air.start();

  let enabled = false;
  let lastSet = 0;

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
      const now = ctx.currentTime;
      master.gain.cancelScheduledValues(now);
      master.gain.setValueAtTime(Math.max(0.0001, master.gain.value), now);
      master.gain.setTargetAtTime(on ? 0.85 : 0.0001, now, on ? 0.9 : 0.12);
      return ctx.state === "running";
    },
    update(energy, pan, heavy) {
      if (!enabled || ctx.state !== "running") return;
      const now = ctx.currentTime;
      if (now - lastSet < 0.03) return;
      lastSet = now;
      const e = Math.max(0, Math.min(1, energy));
      tone.frequency.setTargetAtTime(170 + 2300 * e ** 1.6 + 900 * heavy, now, 0.12);
      tone.Q.value = 1.1 + 2.2 * e;
      body.gain.setTargetAtTime(0.4 + 0.22 * e + 0.12 * heavy, now, 0.2);
      airBand.frequency.setTargetAtTime(500 + 2200 * e, now, 0.15);
      airGain.gain.setTargetAtTime(0.004 + 0.03 * e ** 2 + 0.02 * heavy, now, 0.15);
      if (airPan) airPan.pan.setTargetAtTime(Math.max(-0.7, Math.min(0.7, pan)), now, 0.2);
    },
    breath(inhale) {
      if (!enabled || ctx.state !== "running") return;
      const t = ctx.currentTime + 0.01;
      const dur = inhale ? 1.1 : 2.2;
      const src = ctx.createBufferSource();
      src.buffer = noise;
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.Q.value = 0.6;
      lp.frequency.setValueAtTime(inhale ? 420 : 2600, t);
      lp.frequency.exponentialRampToValueAtTime(inhale ? 2200 : 260, t + dur);
      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(inhale ? 0.05 : 0.075, t + (inhale ? dur * 0.8 : 0.18));
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(lp);
      lp.connect(env);
      env.connect(master);
      env.connect(verb);
      src.start(t, Math.random() * 0.8, dur + 0.1);
      src.onended = () => env.disconnect();
    },
    suspend() {
      if (ctx.state === "running") ctx.suspend().catch(() => {});
    },
    resume() {
      if (enabled && ctx.state === "suspended") ctx.resume().catch(() => {});
    },
    destroy() {
      enabled = false;
      ctx.close().catch(() => {});
    },
  };
}
