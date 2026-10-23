import { createSound, db } from "@/lib/sound/engine";
import { takes } from "./steamTakes";

// Breath across the steam: a looped jet of air whose loudness and
// brightness follow how fast the pointer moves through the words.
export function createBreath() {
  const sound = createSound({ level: -8, room: 0.15 });
  const bank = sound.bank(takes.breath.render, takes.breath);
  let loop = null;
  let shown = 0;

  return {
    unlock() {
      sound.unlock();
      if (!loop && sound.enabled) loop = sound.loop(bank);
    },
    // `v` keeps the old scale: 0.14 and up is a full blow.
    level(v) {
      if (!loop) return;
      const amount = Math.max(0, Math.min(1, v / 0.14));
      if (Math.abs(amount - shown) < 0.004) return;
      shown = amount;
      const t = sound.ctx.currentTime;
      loop.gain.setTargetAtTime(amount > 0.002 ? db(-2) * amount ** 1.3 : 0, t, 0.08);
      loop.rate.setTargetAtTime(0.85 + amount * 0.3, t, 0.12);
    },
    close() {
      loop?.stop();
      loop = null;
      sound.destroy();
    },
  };
}
