import { createSound } from "@/lib/sound/engine";
import { takes } from "./ligatureTakes";

const clampPan = (pan) => Math.max(-0.7, Math.min(0.7, pan || 0));

export function createLigatureSound() {
  let sound = null;
  let bank = null;
  let last = 0;

  function start() {
    if (!sound) {
      sound = createSound({ level: -4, room: 0.08, on: true });
      bank = Object.fromEntries(Object.entries(takes).map(([name, spec]) => [name, sound.bank(spec.render, spec)]));
    }
    sound.unlock();
  }

  // heavy: the last fuse of the cascade, a little lower and louder than the
  // settles before it, so the word is heard to close on the final one.
  function play(name, strength, pan, heavy = false) {
    if (!sound?.live) return;
    const now = performance.now();
    if (now - last < 40) return;
    last = now;
    const s = Math.max(0, Math.min(1, strength));
    sound.play(bank[name], {
      gain: (name === "lock" ? -13 : -22) + s * 7 + (heavy ? 3 : 0) + (Math.random() * 2 - 1),
      pan: clampPan(pan),
      rate: (heavy ? 0.84 : 0.96) + Math.random() * 0.06,
    });
  }

  return {
    start,
    lock: (strength, pan, heavy) => play("lock", strength, pan, heavy),
    part: (strength, pan) => play("part", strength, pan),
    destroy() {
      sound?.destroy();
      sound = null;
    },
  };
}
