import { createSound } from "@/lib/sound/engine";
import { takes } from "./irisTakes";

// The foley of a manual aperture ring (irisTakes.js): a detent at every
// third of a stop, firmer on the full stops, and the blades sliding while
// the ring turns. The ring's notches climb a little as the iris closes and
// the ring tightens.
const GAP = 18;

export function createIrisSound() {
  let sound = null;
  let bank = null;
  let blades = null;
  let lastClick = 0;

  function start() {
    if (!sound) {
      sound = createSound({ level: -3, room: 0.1, on: true });
      bank = Object.fromEntries(Object.entries(takes).map(([name, spec]) => [name, sound.bank(spec.render, spec)]));
    }
    sound.unlock();
  }

  function click(strength, closedness) {
    if (!sound?.live) return;
    const now = performance.now();
    if (now - lastClick < GAP) return;
    lastClick = now;
    const main = strength >= 0.7;
    const c = Math.min(1, Math.max(0, closedness));
    sound.play(main ? bank.full : bank.third, {
      gain: (main ? -6 : -12) + (Math.random() * 2 - 1),
      rate: (0.97 + Math.random() * 0.06) * (1 + 0.12 * c),
    });
  }

  function swish(speed, closedness) {
    if (!sound?.live) return;
    if (!blades) {
      // The idle renderer makes the take; until then the ring is silent
      // between clicks rather than stalling a frame.
      if (!bank.blades.takes[0]) return;
      blades = sound.loop(bank.blades);
      if (!blades) return;
    }
    const now = sound.ctx.currentTime;
    const level = Math.pow(Math.min(1, Math.abs(speed) / 9), 1.4) * 0.5;
    const current = blades.gain.value;
    blades.gain.setTargetAtTime(level, now, level > current ? 0.02 : 0.07);
    blades.rate.setTargetAtTime(0.8 + closedness * 0.45 + Math.min(1, Math.abs(speed) / 9) * 0.15, now, 0.05);
  }

  function destroy() {
    blades?.stop();
    blades = null;
    sound?.destroy();
    sound = null;
  }

  return { start, click, swish, destroy };
}
