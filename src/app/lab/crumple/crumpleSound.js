import { createSound } from "@/lib/sound/engine";
import { takes } from "./crumpleTakes";

// The print crushing (crumpleTakes.js), keyed to the stop-motion: each held
// frame opens with the crinkle of the creases rubbing, and while the sheet
// moves, facets snap through — long folds early in the crush, fine bright
// creases as it becomes a ball.
const FRAME_GAP = 50;
const SNAP_GAP = 0.018;

export function createRustle() {
  const sound = createSound({ level: -7, room: 0.1, on: true });
  const bank = Object.fromEntries(Object.entries(takes).map(([name, spec]) => [name, sound.bank(spec.render, spec)]));
  let last = 0;
  let nextAt = 0;

  const snap = (at, p, strength) => {
    const big = Math.random() > p * 0.85 + 0.1;
    sound.play(big ? bank.snapBig : bank.snapSmall, {
      gain: (big ? -9 : -13) + 4 * (strength - 1) + (Math.random() * 3 - 1.5),
      pan: (Math.random() - 0.5) * 0.5,
      rate: (0.95 + Math.random() * 0.1) * (1 + 0.15 * p),
      at,
    });
  };

  return {
    unlock() {
      sound.unlock();
    },
    rustle(speed, p) {
      if (!sound.live) return;
      const now = performance.now();
      const gap = last ? now - last : Infinity;
      const dt = Number.isFinite(gap) ? Math.min(0.05, gap / 1000) : 1 / 60;
      last = now;
      const strength = Math.min(1, 0.4 + speed);
      // A new held frame: the whole sheet shifts at once.
      if (gap > FRAME_GAP) {
        sound.play(bank.crinkle, { gain: -11 + 5 * (strength - 1) + (Math.random() * 2 - 1), rate: 0.96 + Math.random() * 0.08 });
        snap(0, p, strength);
        nextAt = SNAP_GAP;
        return;
      }
      const density = 0.4 + 0.6 * Math.sin(Math.min(1, p) * Math.PI);
      const rate = Math.min(45, speed * 70 * density);
      let count = 0;
      let x = Math.random();
      const expected = rate * dt;
      while (x < expected && count < 2) {
        count += 1;
        x += Math.random() * 1.2;
      }
      // Spread the snaps over the frame, never closer than SNAP_GAP.
      nextAt = Math.max(0, nextAt - dt);
      for (let i = 0; i < count; i += 1) {
        const at = Math.max(nextAt, Math.random() * dt);
        snap(at, p, strength);
        nextAt = at + SNAP_GAP;
      }
    },
    destroy() {
      sound.destroy();
    },
  };
}
