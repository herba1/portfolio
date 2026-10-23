import { createSound, db } from "@/lib/sound/engine";
import { rng } from "@/lib/sound/synth";
import { takes } from "./smearTakes";

const RATE = 48000;
const clampPan = (pan) => Math.max(-0.7, Math.min(0.7, pan || 0));

// Starts on; the first gesture unlocks it and the speaker button toggles it.
// The slide is a pre-rendered loop on the shared context, panned to where
// the motion is and driven by how much of the block is moving.
export function createAudio() {
  const sound = createSound({ level: -8, room: 0.1, on: true });
  const land = sound.bank(takes.land.render, takes.land);
  let slide = null;
  let lastTick = 0;

  const ensureSlide = () => {
    if (slide) return slide;
    const ctx = sound.ctx;
    const out = sound.out;
    if (!ctx || !out) return null;
    const data = takes.slide.render(RATE, rng(takes.slide.seed * 7919));
    const buffer = ctx.createBuffer(1, data.length, RATE);
    buffer.getChannelData(0).set(data);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(gain);
    let tail = gain;
    let pan = null;
    if (ctx.createStereoPanner) {
      pan = ctx.createStereoPanner();
      gain.connect(pan);
      tail = pan;
    }
    tail.connect(out);
    src.start(ctx.currentTime, Math.random() * buffer.duration);
    slide = { src, gain, pan, tail };
    return slide;
  };

  const hush = (tc = 0.06) => {
    if (!slide) return;
    const t = sound.ctx.currentTime;
    slide.gain.gain.cancelScheduledValues(t);
    slide.gain.gain.setTargetAtTime(0, t, tc);
  };

  return {
    unlock() {
      sound.unlock();
    },
    async setEnabled(on) {
      if (!on) hush(0.03);
      await sound.setEnabled(on);
      return sound.ctx ? on : false;
    },
    // `energy` 0..1 is how much the block is moving; `x` is where, -1..1.
    motion(energy, x) {
      if (!sound.live) return;
      const s = ensureSlide();
      if (!s) return;
      const t = sound.ctx.currentTime;
      const e = Math.min(1, Math.max(0, energy));
      s.gain.gain.setTargetAtTime(e * e * db(-6), t, 0.05);
      // Faster drag, brighter rub.
      s.src.playbackRate.setTargetAtTime(0.75 + e * 0.6, t, 0.06);
      if (s.pan) s.pan.pan.setTargetAtTime(clampPan(x), t, 0.08);
    },
    land(x, line, level = 1) {
      if (!sound.live) return;
      const now = performance.now();
      if (now - lastTick < 30) return;
      lastTick = now;
      const rate = Math.max(0.85, 1 - Math.max(0, line) * 0.008) * (0.97 + Math.random() * 0.06);
      sound.play(land, { gain: -13 + 20 * Math.log10(Math.max(0.05, level)) + Math.random() * 2 - 1, pan: clampPan(x), rate });
    },
    quiet() {
      hush();
    },
    destroy() {
      if (slide) {
        hush(0.02);
        slide.src.stop(sound.ctx.currentTime + 0.15);
        const { tail, gain } = slide;
        slide.src.onended = () => {
          tail.disconnect();
          if (tail !== gain) gain.disconnect();
        };
        slide = null;
      }
      sound.destroy();
    },
  };
}
