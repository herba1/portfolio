import { createSound } from "@/lib/sound/engine";
import { takes } from "./foleyTakes";

// One client for the module, made on the first gesture so nothing touches
// audio during server rendering.
let sound = null;
let bank = null;
let lastTick = 0;

export function wakeAudio() {
  if (typeof window === "undefined") return;
  if (!sound) {
    sound = createSound({ level: -8, room: 0.1 });
    bank = Object.fromEntries(Object.entries(takes).map(([name, spec]) => [name, sound.bank(spec.render, spec)]));
  }
  sound.unlock();
}

const vary = () => Math.random() * 2 - 1;

// The cover lifts free and the menu opens.
export const thunk = () => sound?.play(bank.thunk, { gain: -5 + vary(), rate: 0.97 + Math.random() * 0.06 });

// Crossing a row: a fast slide across the menu would otherwise pile these up.
export const tick = () => {
  if (!sound?.live) return;
  const now = performance.now();
  if (now - lastTick < 32) return;
  lastTick = now;
  sound.play(bank.tick, { gain: -13 + vary(), rate: 0.97 + Math.random() * 0.06 });
};

// Choosing an item.
export const pick = () => sound?.play(bank.pick, { gain: -8 + vary() });
