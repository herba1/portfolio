import { createSound } from "@/lib/sound/engine";
import { takes } from "./musicaTakes";

// Each ring that settles into its consonance sounds its interval once, soft.
// Silent until the first pointerdown unlocks audio.
export function createMusicaSound() {
  let sound = null;
  let bank = null;

  function start() {
    if (!sound) {
      sound = createSound({ level: -9, room: 0.22, on: true });
      bank = sound.bank(takes.tone.render, takes.tone);
    }
    sound.unlock();
  }

  function ring(ratio, weight, pan) {
    if (!sound?.live) return;
    sound.play(bank, { gain: -4 - (1 - weight) * 8 + (Math.random() * 2 - 1), rate: ratio, pan });
  }

  function destroy() {
    sound?.destroy();
    sound = null;
  }

  return { start, ring, destroy };
}
