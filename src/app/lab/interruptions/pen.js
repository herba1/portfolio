import { createSound } from "@/lib/sound/engine";
import { takes } from "./penTakes";

// The pen coming back to redraw a lifted line. Heals arrive in loose runs,
// so the ticks are thinned to a soft, uneven pecking rather than a buzz.
export function createPen() {
  const sound = createSound({ level: -14, room: 0.05 });
  const bank = sound.bank(takes.down.render, takes.down);
  let last = 0;
  let gap = 60;
  return {
    unlock: () => sound.unlock(),
    down() {
      if (!sound.live) return;
      const now = performance.now();
      if (now - last < gap) return;
      last = now;
      gap = 55 + Math.random() * 90;
      sound.play(bank, { gain: -6 + (Math.random() * 3 - 1.5), rate: 0.94 + Math.random() * 0.12 });
    },
    destroy: () => sound.destroy(),
  };
}
