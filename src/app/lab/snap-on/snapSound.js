import { createSound } from "@/lib/sound/engine";
import { takes } from "./snapTakes";

const clampPan = (pan) => Math.max(-0.6, Math.min(0.6, pan || 0));
const LEVEL = { seat: -11, notch: -21, pop: -17 };

export function createSnapSound() {
  let sound = null;
  let bank = null;
  const last = {};

  function start() {
    if (!sound) {
      sound = createSound({ level: -4, room: 0.05, on: true });
      bank = Object.fromEntries(Object.entries(takes).map(([name, spec]) => [name, sound.bank(spec.render, spec)]));
    }
    sound.unlock();
  }

  function play(name, pan, strength = 1) {
    if (!sound?.live) return;
    const now = performance.now();
    if (now - (last[name] || 0) < 35) return;
    last[name] = now;
    sound.play(bank[name], {
      gain: LEVEL[name] + (strength - 1) * 6 + (Math.random() * 2 - 1),
      pan: clampPan(pan),
      rate: 0.97 + Math.random() * 0.05,
    });
  }

  return {
    start,
    seat: (pan, s) => play("seat", pan, s),
    notch: (pan, s) => play("notch", pan, s),
    pop: (pan, s) => play("pop", pan, s),
    destroy() {
      sound?.destroy();
      sound = null;
    },
  };
}
