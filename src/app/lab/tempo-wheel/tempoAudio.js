import { createSound } from "@/lib/sound/engine";
import { takes } from "./tempoTakes";

// Silent until the first gesture unlocks it: then the beat is scheduled a
// few frames ahead on the audio clock, so it never wavers with the frame
// rate, and each whole number the ruler crosses gives a faint detent.
export function createAudio() {
  const sound = createSound({ level: -6, room: 0.08, on: true });
  const bank = Object.fromEntries(Object.entries(takes).map(([name, spec]) => [name, sound.bank(spec.render, spec)]));
  let lastDetent = 0;
  let unlocked = false;

  return {
    get unlocked() {
      return unlocked;
    },
    unlock() {
      unlocked = true;
      sound.unlock();
    },
    beat(at) {
      if (!unlocked || !sound.live) return;
      sound.play(bank.beat, { gain: -9 + Math.random() * 0.8, rate: 0.995 + Math.random() * 0.01, at });
    },
    // speed in units a second: a fast fling ticks quieter, as a real
    // ratchet blurs into a purr.
    detent(speed) {
      if (!unlocked || !sound.live) return;
      const now = performance.now();
      if (now - lastDetent < 22) return;
      lastDetent = now;
      const g = -22 - Math.min(10, speed / 12) + Math.random() * 1.5;
      sound.play(bank.detent, { gain: g, rate: 0.97 + Math.random() * 0.06 });
    },
    destroy() {
      sound.destroy();
    },
  };
}
