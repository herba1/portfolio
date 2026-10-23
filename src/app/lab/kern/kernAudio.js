import { createSound } from "@/lib/sound/engine";
import { takes } from "./kernTakes";

const clampPan = (pan) => Math.max(-0.8, Math.min(0.8, pan || 0));

// Created and switched on by the first gesture on the piece.
export function createKernSound() {
  const sound = createSound({ level: -8, room: 0.12, on: false });
  if (!sound.ctx) return null;
  const bank = Object.fromEntries(Object.entries(takes).map(([name, spec]) => [name, sound.bank(spec.render, spec)]));
  let lastTick = 0;

  return {
    setEnabled(on) {
      return sound.setEnabled(on);
    },
    grab(pan) {
      if (!sound.live) return;
      sound.play(bank.grab, { gain: -9 + Math.random() * 2 - 1, pan: clampPan(pan), rate: 0.97 + Math.random() * 0.06 });
    },
    // `energy` is how far the letter was pulled (in letter sizes): a longer
    // pull lets the spring go louder and at a higher tension.
    release(energy, pan) {
      if (!sound.live) return;
      const e = Math.max(0.15, Math.min(1, energy));
      sound.play(bank.release, { gain: -15 + e * 10, pan: clampPan(pan), rate: 0.94 + e * 0.12 + Math.random() * 0.02 });
    },
    settle(pan, speed) {
      if (!sound.live) return;
      const now = performance.now();
      if (now - lastTick < 30) return;
      lastTick = now;
      const gain = -20 + Math.min(8, speed * 0.01) + Math.random() * 2;
      sound.play(bank.settle, { gain, pan: clampPan(pan), rate: 0.97 + Math.random() * 0.06 });
    },
    key(pan) {
      if (!sound.live) return;
      sound.play(bank.key, { gain: -8 + Math.random() * 2 - 1, pan: clampPan(pan), rate: 0.97 + Math.random() * 0.06 });
    },
    morph(up) {
      if (!sound.live) return;
      sound.play(up ? bank.heavier : bank.lighter, { gain: -14 });
    },
    destroy() {
      sound.destroy();
    },
  };
}
