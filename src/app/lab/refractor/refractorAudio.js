import { createSound } from "@/lib/sound/engine";
import { takes } from "./refractorTakes";

export function createRefractorAudio() {
  const sound = createSound({ level: -3, room: 0.12 });
  const snapBank = sound.bank(takes.snap.render, takes.snap);
  let last = 0;

  function start() {
    sound.unlock();
  }

  // One riffle per disc that turns past edge-on. A hard flick can turn
  // several in a row, so space them rather than stack them.
  function snap(strength = 1) {
    if (!sound.live) return;
    const now = performance.now();
    if (now - last < 40) return;
    last = now;
    const level = 20 * Math.log10(Math.max(0.05, Math.min(1, strength)));
    sound.play(snapBank, { gain: -9 + level + (Math.random() * 3 - 1.5), rate: 0.97 + Math.random() * 0.06 });
  }

  function destroy() {
    sound.destroy();
  }

  return { start, snap, destroy };
}
