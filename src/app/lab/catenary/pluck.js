import { createSound } from "@/lib/sound/engine";
import { takes } from "./pluckTakes";

// One dry pluck as a wire slips off the hand. Its level follows how far the
// wire was drawn; its pitch follows the wire (a heavier, slower span sounds
// lower). Silent until the first gesture (browsers start audio only inside
// one), and quiet: it sits under the picture.
export function createPluckSound() {
  const sound = createSound({ level: -12, room: 0.06 });
  const bank = sound.bank(takes.pluck.render, takes.pluck);
  let last = 0;
  return {
    wake() {
      if (typeof window !== "undefined") sound.unlock();
    },
    pluck({ wire = 0, drawn = 0, at = 0.5, f1 = 1.5, speed = 0 }) {
      if (!sound.live) return;
      const now = performance.now();
      if (now - last < 24) return;
      last = now;
      // drawn is device px; a full pull is ~40.
      const s = Math.min(1, drawn / 40);
      if (s < 0.08) return;
      const gain = -20 + 16 * Math.sqrt(s) + Math.min(2, speed / 1500) + (Math.random() * 2 - 1) * 0.8;
      const rate = (f1 / 1.5) ** 0.35 * (0.98 + Math.random() * 0.04);
      const pan = (at - 0.5) * 0.4 + (wire >= 2 ? 0.15 : -0.15);
      sound.play(bank, { gain, rate, pan });
    },
    destroy: () => sound.destroy(),
  };
}
