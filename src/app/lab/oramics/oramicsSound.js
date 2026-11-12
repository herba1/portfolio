import { soundAllowed } from "@/lib/sound/desktopOnly";

// The machine's sound, one stage per strip of film. The pitch strip gives
// one held tone per run of ink the light finds on the line; every voice
// plays the waveform the timbre strip draws (as harmonics, a PeriodicWave),
// with a twin a few cents sharp for warmth; the amplitude strip is a VCA on
// all of them; the last strip sets the vibrato's depth and the send to a
// dark room. Silent until the first touch; nothing is built before it.

const SLEEP_AFTER_MS = 9000;

function roomImpulse(ctx, seconds = 2.6) {
  const sr = ctx.sampleRate;
  const length = Math.floor(sr * seconds);
  const buffer = ctx.createBuffer(2, length, sr);
  for (let c = 0; c < 2; c += 1) {
    const data = buffer.getChannelData(c);
    let seed = 7919 + c * 104729;
    let low = 0;
    const pre = Math.floor(sr * 0.014);
    for (let i = pre; i < length; i += 1) {
      seed = (seed * 16807) % 2147483647;
      const n = (seed / 2147483647) * 2 - 1;
      const t = (i - pre) / sr;
      // Darker as it goes: the highs die first.
      low += (n - low) * (0.32 - 0.26 * Math.min(1, t / seconds));
      data[i] = low * Math.exp(-t / 0.62) * 0.5;
    }
  }
  return buffer;
}

export function createOramicsSound(count) {
  if (!soundAllowed()) return null;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;

  let ctx = null;
  let master = null;
  let voices = [];
  let lastLoud = 0;
  let vca = null;
  let depth = null;
  let send = null;
  let shape = [0.1, 0, 0.3];
  let harmonics = null;

  const applyWave = () => {
    if (!ctx || !harmonics) return;
    const w = ctx.createPeriodicWave(harmonics[0], harmonics[1]);
    for (const v of voices) {
      v.a.setPeriodicWave(w);
      v.b.setPeriodicWave(w);
    }
  };

  const build = () => {
    ctx = new Ctx({ latencyHint: "interactive" });
    master = ctx.createGain();
    master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.knee.value = 14;
    comp.ratio.value = 3;
    comp.attack.value = 0.012;
    comp.release.value = 0.3;
    master.connect(comp).connect(ctx.destination);

    const bus = ctx.createGain();
    bus.gain.value = 0.8;
    vca = ctx.createGain();
    vca.gain.value = shape[0];
    // Open enough that a jagged waveform is heard as jagged.
    const soft = ctx.createBiquadFilter();
    soft.type = "lowpass";
    soft.frequency.value = 5200;
    soft.Q.value = 0.4;
    const low = ctx.createBiquadFilter();
    low.type = "highpass";
    low.frequency.value = 60;
    low.Q.value = 0.5;
    bus.connect(vca).connect(soft).connect(low);
    low.connect(master);
    const room = ctx.createConvolver();
    room.buffer = roomImpulse(ctx);
    send = ctx.createGain();
    send.gain.value = 0.06 + 0.7 * shape[2];
    low.connect(send).connect(room).connect(master);

    // The vibrato shared by every voice; its depth, in cents, is drawn.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 4.7;
    depth = ctx.createGain();
    depth.gain.value = 2 + 38 * shape[1];
    lfo.connect(depth);
    const drift = ctx.createOscillator();
    drift.frequency.value = 0.17;
    const driftDepth = ctx.createGain();
    driftDepth.gain.value = 3;
    drift.connect(driftDepth);
    lfo.start();
    drift.start();

    voices = Array.from({ length: count }, (_, i) => {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      const pan = ctx.createStereoPanner();
      pan.pan.value = 0;
      gain.connect(pan).connect(bus);
      const a = ctx.createOscillator();
      const b = ctx.createOscillator();
      const bGain = ctx.createGain();
      bGain.gain.value = 0.3;
      a.connect(gain);
      b.connect(bGain).connect(gain);
      b.detune.value = 3 + i * 0.7;
      for (const o of [a, b]) {
        o.frequency.value = 220;
        depth.connect(o.detune);
        driftDepth.connect(o.detune);
        o.start();
      }
      return { gain, pan, a, b, level: 0 };
    });
    applyWave();
    master.gain.setValueAtTime(0, ctx.currentTime);
    master.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 0.5);
  };

  return {
    start() {
      if (!ctx) build();
      if (ctx.state !== "running") ctx.resume().catch(() => {});
    },
    get live() {
      return Boolean(ctx) && ctx.state === "running";
    },
    // freq in Hz, level 0..1, pan -1..1; `snap` jumps to the pitch (a new
    // run of ink) instead of gliding from the last one.
    voice(i, freq, level, pan, snap) {
      if (!ctx) return;
      const v = voices[i];
      const now = ctx.currentTime;
      if (level > 0.001) {
        lastLoud = performance.now();
        if (ctx.state === "suspended") ctx.resume().catch(() => {});
      }
      for (const o of [v.a, v.b]) {
        if (snap) {
          o.frequency.cancelScheduledValues(now);
          o.frequency.setValueAtTime(freq, now);
        } else {
          o.frequency.setTargetAtTime(freq, now, 0.03);
        }
      }
      v.gain.gain.setTargetAtTime(level, now, level > v.level ? 0.018 : 0.07);
      v.pan.pan.setTargetAtTime(pan, now, 0.1);
      v.level = level;
    },
    // The control strips at the reader: VCA gain, vibrato depth 0..1, room
    // send 0..1, eased with the same time constants the print uses.
    shape(env, vib, wet) {
      shape = [env, vib, wet];
      if (!ctx) return;
      const now = ctx.currentTime;
      vca.gain.setTargetAtTime(env, now, 0.015);
      depth.gain.setTargetAtTime(2 + 38 * vib, now, 0.1);
      send.gain.setTargetAtTime(0.06 + 0.7 * wet, now, 0.12);
    },
    // One cycle of the timbre strip, as cosine and sine harmonics.
    wave(re, im) {
      harmonics = [Float32Array.from(re), Float32Array.from(im)];
      applyWave();
    },
    silence() {
      if (!ctx) return;
      const now = ctx.currentTime;
      for (const v of voices) {
        v.gain.gain.setTargetAtTime(0, now, 0.06);
        v.level = 0;
      }
    },
    tick() {
      // Nothing on the line for a while: let the audio hardware sleep.
      if (ctx && ctx.state === "running" && performance.now() - lastLoud > SLEEP_AFTER_MS) ctx.suspend().catch(() => {});
    },
    destroy() {
      if (ctx) ctx.close().catch(() => {});
      ctx = null;
    },
  };
}
