import { createSound } from "@/lib/sound/engine";
import { takes } from "./detentTakes";

// One click per wheel as its pawl drops into a notch. Silent until the first
// pointerdown or key (browsers start audio only inside a gesture).
export function createDetents() {
  const sound = createSound({ level: -5, room: 0.08 });
  const bank = sound.bank(takes.detent.render, takes.detent);
  let last = 0;

  const wake = () => {
    if (typeof window !== "undefined") sound.unlock();
  };

  // `speed` is how fast the wheel met the notch, in titles a second: a
  // flung wheel lands harder than one eased in under the thumb. `wheel`
  // pans the click across the row, a few degrees, as the drums sit.
  const click = (speed, wheel, wheels) => {
    if (!sound.live) return;
    const now = performance.now();
    if (now - last < 14) return;
    last = now;
    const s = Math.min(1, speed / 3);
    const gain = -16 + 13 * Math.sqrt(s) + (Math.random() * 2 - 1) * 0.8;
    const pan = ((wheel + 0.5) / wheels - 0.5) * 0.5;
    sound.play(bank, { gain, pan, rate: (0.98 + Math.random() * 0.04) * (1 - 0.006 * wheel) });
  };

  return { wake, click, destroy: () => sound.destroy() };
}
