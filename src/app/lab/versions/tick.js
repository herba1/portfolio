import { createSound } from "@/lib/sound/engine";
import { takes } from "./tickTakes";

// One tick each time a whole version settles to the front. Silent until the
// first pointerdown or key (browsers start audio only inside a gesture).
export function createTicks() {
  const sound = createSound({ level: -8, room: 0.06 });
  const bank = sound.bank(takes.tick.render, takes.tick);
  let last = 0;

  const wake = () => {
    if (typeof window !== "undefined") sound.unlock();
  };

  // `speed` is versions a second: a flick through the stack ticks lighter
  // and a hair higher per card than one eased into place.
  const tick = (speed) => {
    if (!sound.live) return;
    const now = performance.now();
    if (now - last < 28) return;
    last = now;
    const s = Math.min(1, speed / 12);
    const gain = -9 - 7 * s + (Math.random() * 2 - 1) * 0.8;
    sound.play(bank, { gain, rate: (0.98 + Math.random() * 0.04) * (1 + 0.05 * s) });
  };

  return { wake, tick, destroy: () => sound.destroy() };
}
