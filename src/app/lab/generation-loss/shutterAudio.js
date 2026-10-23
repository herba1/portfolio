import { createSound } from "@/lib/sound/engine";
import { takes } from "./shutterTakes";

// A shutter per JPEG save (shutterTakes.js), louder the harder the save.
const MIN_GAP = 30;

export function createShutter() {
  const sound = createSound({ level: -3, room: 0.12, on: true });
  if (!sound.ctx) return null;
  const bank = sound.bank(takes.shutter.render, takes.shutter);
  let last = 0;

  return {
    get ctx() {
      return sound.ctx;
    },
    async wake() {
      if (sound.enabled) sound.unlock();
    },
    async setEnabled(on) {
      return sound.setEnabled(on);
    },
    shutter(intensity = 1) {
      if (!sound.live) return;
      const now = performance.now();
      if (now - last < MIN_GAP) return;
      last = now;
      const k = Math.min(1, Math.max(0, intensity));
      sound.play(bank, {
        gain: -9 + 5 * k + (Math.random() * 2 - 1),
        pan: (Math.random() - 0.5) * 0.24,
        rate: 0.98 + Math.random() * 0.04,
      });
    },
    destroy() {
      sound.destroy();
    },
  };
}
