import { createSound } from "@/lib/sound/engine";
import { takes } from "./selectTakes";

export function createAudio() {
  const sound = createSound({ level: -3, room: 0.1 });
  const bank = Object.fromEntries(Object.entries(takes).map(([name, spec]) => [name, sound.bank(spec.render, spec)]));
  let lastTick = 0;

  return {
    unlock() {
      sound.unlock();
    },
    setEnabled(on) {
      return sound.setEnabled(on);
    },
    tick(pan = 0) {
      if (!sound.live) return;
      const now = performance.now();
      // A fast drag crosses words quicker than detents can speak: thin them
      // rather than pile them up.
      if (now - lastTick < 34) return;
      lastTick = now;
      sound.play(bank.tick, { gain: -10 + Math.random() * 2, pan: pan * 0.8, rate: 0.97 + Math.random() * 0.06 });
    },
    lift(pan = 0) {
      sound.play(bank.lift, { gain: -9, pan });
      sound.play(bank.air, { gain: -20, pan, at: 0.01 });
    },
    settle(pan = 0) {
      sound.play(bank.settle, { gain: -6, pan });
    },
    pop() {
      sound.play(bank.pop, { gain: -9 });
      sound.play(bank.pop, { gain: -15, rate: 1.5, at: 0.055 });
    },
    whoosh() {
      sound.play(bank.whoosh, { gain: -14 });
    },
    destroy() {
      sound.destroy();
    },
  };
}
