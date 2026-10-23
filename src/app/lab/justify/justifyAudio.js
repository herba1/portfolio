import { createSound } from "@/lib/sound/engine";
import { takes } from "./justifyTakes";

const clampPan = (pan) => Math.max(-0.8, Math.min(0.8, pan || 0));

// Starts on; the first gesture unlocks it, the "sound / quiet" word toggles.
export function createAudio() {
  const sound = createSound({ level: -8, room: 0.1, on: true });
  const bank = Object.fromEntries(Object.entries(takes).map(([name, spec]) => [name, sound.bank(spec.render, spec)]));
  let lastTick = 0;
  let lastKey = 0;

  return {
    unlock() {
      sound.unlock();
    },
    async setEnabled(on) {
      await sound.setEnabled(on);
      return sound.ctx ? on : false;
    },
    // A word landing in `line` (0 at the top): lower lines sit a little
    // lower in pitch, as if further down the galley.
    tick(pan, line) {
      if (!sound.live) return;
      const now = performance.now();
      if (now - lastTick < 30) return;
      lastTick = now;
      const rate = Math.max(0.78, 1 - Math.max(0, line) * 0.025) * (0.97 + Math.random() * 0.06);
      sound.play(bank.tick, { gain: -12 + Math.random() * 2 - 1, pan: clampPan(pan), rate });
    },
    key(pan) {
      if (!sound.live) return;
      const now = performance.now();
      if (now - lastKey < 30) return;
      lastKey = now;
      sound.play(bank.key, { gain: -9 + Math.random() * 2 - 1, pan: clampPan(pan), rate: 0.97 + Math.random() * 0.06 });
    },
    // `level` is the softness, 0..1: the detents climb with it.
    detent(level) {
      if (!sound.live) return;
      sound.play(bank.detent, { gain: -16 + Math.random() * 2, rate: 0.9 + level * 0.3 });
    },
    destroy() {
      sound.destroy();
    },
  };
}
