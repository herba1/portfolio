import { createSound } from "@/lib/sound/engine";
import { takes } from "./lensTakes";

// The foley of a manual focus ring (lensTakes.js): grease while it turns, a
// ball detent at every mark, a cushioned thunk at the end of travel.
const TICK_GAP = 22;

export function createLensAudio() {
  const sound = createSound({ level: -7, room: 0.08, on: true });
  if (!sound.ctx) return null;
  const bank = Object.fromEntries(Object.entries(takes).map(([name, spec]) => [name, sound.bank(spec.render, spec)]));
  let bed = null;
  let last = 0;

  const ensureBed = () => {
    // Started once the idle renderer has the grease take, never by forcing
    // a three-second render inside a drag.
    if (!bed && bank.grease.takes[0]) bed = sound.loop(bank.grease);
    return bed;
  };

  return {
    async wake() {
      if (sound.enabled) sound.unlock();
    },
    async setEnabled(on) {
      if (!on) bed?.gain.setTargetAtTime(0, sound.ctx.currentTime, 0.03);
      return sound.setEnabled(on);
    },
    friction(speed) {
      if (!sound.live) return;
      const b = ensureBed();
      if (!b) return;
      const s = Math.min(1, Math.abs(speed));
      const now = sound.ctx.currentTime;
      b.gain.setTargetAtTime(s * 0.55, now, 0.04);
      // Faster shear pitches the grease up, as the band did before.
      b.rate.setTargetAtTime(0.85 + s * 0.9, now, 0.06);
    },
    detent(speed) {
      if (!sound.live) return;
      const now = performance.now();
      if (now - last < TICK_GAP) return;
      last = now;
      const s = Math.min(1, Math.abs(speed));
      sound.play(bank.detent, { gain: -15 + 5 * s + (Math.random() * 2 - 1), rate: 0.97 + Math.random() * 0.06 });
    },
    stop() {
      if (!sound.live) return;
      sound.play(bank.stop, { gain: -5 + Math.random(), rate: 0.98 + Math.random() * 0.04 });
    },
    destroy() {
      bed?.stop();
      bed = null;
      sound.destroy();
      return Promise.resolve();
    },
  };
}
