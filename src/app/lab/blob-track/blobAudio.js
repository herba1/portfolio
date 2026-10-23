import { createSound } from "@/lib/sound/engine";
import { takes } from "./blobTakes";

// Starts off; the piece's "Blips" toggle turns it on through setEnabled.
export function createBlips() {
  const sound = createSound({ level: -3, room: 0.08, on: false });
  const bank = Object.fromEntries(Object.entries(takes).map(([name, spec]) => [name, sound.bank(spec.render, spec)]));
  let last = 0;
  const clampPan = (pan) => Math.max(-0.8, Math.min(0.8, pan));
  const vary = () => Math.random() * 2 - 1;

  return {
    beat(accent, drop) {
      if (!sound.live) return;
      if (drop) sound.play(bank.drop, { gain: -4 + vary() });
      else if (accent >= 0.9) sound.play(bank.knock, { gain: -10 + vary() });
      if (accent >= 0.3) {
        const pan = clampPan(Math.random() * 0.8 - 0.4);
        sound.play(bank.hat, { gain: -11 + Math.min(1.5, accent) * 3 + vary(), pan, rate: 0.98 + Math.random() * 0.04 });
      }
    },
    setEnabled(on) {
      return sound.setEnabled(on);
    },
    // A new track locks on: bigger boxes beep lower.
    acquire(size, pan) {
      if (!sound.live) return;
      const now = performance.now();
      if (now - last < 45) return;
      last = now;
      const freq = 3400 - Math.min(1, size) * 1500 + Math.floor(Math.random() * 7) * 40;
      sound.play(bank.lock, { gain: -17 + vary(), pan: clampPan(pan), rate: freq / 2400 });
    },
    lose(pan) {
      if (!sound.live) return;
      const now = performance.now();
      if (now - last < 60) return;
      last = now;
      sound.play(bank.lose, { gain: -21 + vary(), pan: clampPan(pan), rate: 0.98 + Math.random() * 0.1 });
    },
    destroy() {
      sound.destroy();
    },
  };
}
