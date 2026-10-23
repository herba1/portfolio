import { createSound, db } from "@/lib/sound/engine";
import { takes } from "./smearTakes";

const clampPan = (pan) => Math.max(-0.7, Math.min(0.7, pan || 0));

// Starts on; the first gesture unlocks it and the speaker button toggles it.
// The slide is a pre-rendered loop on the shared context, panned to where
// the motion is and driven by how much of the block is moving.
export function createAudio() {
  const sound = createSound({ level: -3, room: 0.1, on: true });
  const land = sound.bank(takes.land.render, takes.land);
  const slideBank = sound.bank(takes.slide.render, takes.slide);
  let slide = null;
  let lastTick = 0;

  const ensureSlide = () => {
    if (!slide && sound.ctx) slide = sound.loop(slideBank);
    return slide;
  };

  const hush = (tc = 0.06) => {
    if (!slide) return;
    const t = sound.ctx.currentTime;
    slide.gain.cancelScheduledValues(t);
    slide.gain.setTargetAtTime(0, t, tc);
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
      s.gain.setTargetAtTime(e * e * db(-6), t, 0.05);
      // Faster drag, brighter rub.
      s.rate.setTargetAtTime(0.75 + e * 0.6, t, 0.06);
      s.pan?.setTargetAtTime(clampPan(x), t, 0.08);
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
      slide?.stop();
      slide = null;
      sound.destroy();
    },
  };
}
