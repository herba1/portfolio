import { createSound, db } from "@/lib/sound/engine";
import { takes } from "./vinylTakes";

export function createVinylAudio() {
  const sound = createSound({ level: -3, room: 0.1 });
  const slideBank = sound.bank(takes.slide.render, takes.slide);
  const surfaceBank = sound.bank(takes.surface.render, takes.surface);
  let crackle = null;

  const wake = () => {
    if (typeof window === "undefined") return;
    sound.unlock();
  };

  // The record drawn out of its sleeve; `level` keeps the old linear scale
  // (0.035 for a full pull, 0.02 for the return) as a relative loudness.
  const slide = (level = 0.03) => {
    if (!sound.live) return;
    const rel = 20 * Math.log10(Math.max(0.002, level) / 0.035);
    sound.play(slideBank, { gain: -6 + rel + (Math.random() * 2 - 1), rate: 0.96 + Math.random() * 0.08 });
  };

  const startCrackle = () => {
    if (!sound.live || crackle) return;
    crackle = sound.loop(surfaceBank);
    if (!crackle) return;
    const t = sound.ctx.currentTime;
    crackle.gain.setValueAtTime(0, t);
    crackle.gain.setTargetAtTime(db(-15), t, 0.07);
  };

  const stopCrackle = () => {
    if (!crackle) return;
    const ctx = sound.ctx;
    const { gain } = crackle;
    if (ctx) {
      // A slower fade than the loop's own stop, as the platter winds down.
      const t = ctx.currentTime;
      gain.cancelScheduledValues(t);
      gain.setTargetAtTime(0, t, 0.09);
    }
    const loop = crackle;
    crackle = null;
    setTimeout(() => loop.stop(), 320);
  };

  return {
    wake,
    slide,
    startCrackle,
    stopCrackle,
    destroy() {
      crackle?.stop();
      crackle = null;
      sound.destroy();
    },
  };
}
