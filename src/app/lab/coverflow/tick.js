import { createSound } from "@/lib/sound/engine";
import { takes } from "./tickTakes";

export function createTicks() {
  const sound = createSound({ level: -3, room: 0.1 });
  const tickBank = sound.bank(takes.tick.render, takes.tick);
  const flickBank = sound.bank(takes.flick.render, takes.flick);
  let last = 0;

  const wake = () => {
    if (typeof window === "undefined") return;
    sound.unlock();
  };

  // A sleeve passing the middle. Flung fast, the sleeves blur into a lighter,
  // quicker riffle, so each one is quieter and a touch higher.
  const tick = (speed = 0) => {
    if (!sound.live) return;
    const now = performance.now();
    if (now - last < 30) return;
    last = now;
    const s = Math.min(speed, 12);
    const gain = -10 - 20 * Math.log10(1 + s * 0.08) + (Math.random() * 2 - 1);
    sound.play(tickBank, { gain, rate: (0.97 + Math.random() * 0.06) * (1 + s * 0.012) });
  };

  const flick = () => {
    sound.play(flickBank, { gain: -7 + (Math.random() * 2 - 1), rate: 0.97 + Math.random() * 0.06 });
  };

  const destroy = () => {
    sound.destroy();
  };

  return { wake, tick, flick, destroy };
}
