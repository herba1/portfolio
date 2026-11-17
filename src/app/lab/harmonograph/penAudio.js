import { createSound, db } from "@/lib/sound/engine";
import { takes } from "./penTakes";

// The nib on the paper: a looped hiss whose loudness and brightness follow
// the pen's speed over the sheet, silent while the pen is lifted. Nothing
// sounds until the first pointerdown unlocks it.
export function createNib() {
  const sound = createSound({ level: -15, room: 0.06 });
  const bank = sound.bank(takes.nib.render, takes.nib);
  let loop = null;
  let shown = -1;

  return {
    unlock() {
      sound.unlock();
      if (!loop && sound.enabled) loop = sound.loop(bank);
    },
    // amount 0..1: how hard the pen is running over the paper.
    level(amount) {
      if (!loop) return;
      const a = Math.max(0, Math.min(1, amount));
      if (Math.abs(a - shown) < 0.01) return;
      const rising = a > shown;
      shown = a;
      const t = sound.ctx.currentTime;
      loop.gain.setTargetAtTime(a > 0.01 ? db(-1) * a ** 1.4 : 0, t, rising ? 0.03 : 0.06);
      loop.rate.setTargetAtTime(0.7 + a * 0.45, t, 0.08);
    },
    close() {
      loop?.stop();
      loop = null;
      sound.destroy();
    },
  };
}
