import { createSound } from "@/lib/sound/engine";
import { takes } from "./t9Takes";

// Starts off; the Sound button turns it on.
export function createT9Sound() {
  const sound = createSound({ level: -8, room: 0.08, on: false });
  if (!sound.ctx) return null;
  const bank = Object.fromEntries(Object.entries(takes).map(([name, spec]) => [name, sound.bank(spec.render, spec)]));
  let lastKey = 0;

  return {
    setEnabled(on) {
      return sound.setEnabled(on);
    },
    // `index` counts presses: it leans each one a little left or right, as
    // the thumb moves across the keypad.
    key(index = 0) {
      if (!sound.live) return;
      const now = performance.now();
      if (now - lastKey < 30) return;
      lastKey = now;
      const pan = (((index * 13) % 9) / 9 - 0.5) * 0.3;
      sound.play(bank.key, { gain: -9 + Math.random() * 2 - 1, pan, rate: 0.97 + Math.random() * 0.06 });
      sound.play(bank.tone, { gain: -27, at: 0.004 });
    },
    sent() {
      if (!sound.live) return;
      sound.play(bank.sent, { gain: -10 });
    },
    destroy() {
      sound.destroy();
    },
  };
}
