import { createSound } from "@/lib/sound/engine";
import { BASE, takes } from "./moireTakes";

// Two copies of the line-screen tone, one per grating. The bottom screen
// plays at rate 1; the top one is sped up by exactly the fringe rate, so the
// fundamentals beat at the rate the fringes pass and fall still when the
// image locks in. Clarity opens the upper harmonics, as the picture sharpens.
const LEVEL = { low: 0.5, high: 0.42 };

export function createMoireSound() {
  const sound = createSound({ level: -9, room: 0.06, on: false });
  if (!sound.ctx) return null;
  const bank = { low: sound.bank(takes.low.render, takes.low), high: sound.bank(takes.high.render, takes.high) };
  // Two seconds of four sines each render in a few milliseconds, so the
  // loops are made on the gesture that turns sound on.
  let pairs = null;
  let enabled = false;
  let open = 0.5;

  const startPairs = () => {
    if (pairs) return pairs;
    const make = (name) => [sound.loop(bank[name]), sound.loop(bank[name])];
    pairs = { low: make("low"), high: make("high") };
    return pairs;
  };

  const level = (target, tau) => {
    if (!pairs) return;
    const now = sound.ctx.currentTime;
    for (const name of ["low", "high"]) {
      const g = name === "low" ? LEVEL.low : LEVEL.high * open;
      for (const loop of pairs[name]) {
        if (!loop) continue;
        loop.gain.cancelScheduledValues(now);
        loop.gain.setTargetAtTime(g * target, now, tau);
      }
    }
  };

  return {
    async setEnabled(on) {
      enabled = on;
      if (on) {
        const ok = await sound.setEnabled(true);
        if (!ok || !enabled) return false;
        startPairs();
        level(1, 0.2);
        return true;
      }
      level(0, 0.06);
      await new Promise((r) => setTimeout(r, 260));
      if (!enabled) await sound.setEnabled(false);
      return false;
    },
    update(beat, clarity) {
      if (!enabled || !pairs || !sound.live) return;
      const now = sound.ctx.currentTime;
      const rate = 1 + beat / BASE;
      for (const name of ["low", "high"]) pairs[name][1]?.rate.setTargetAtTime(rate, now, 0.05);
      open = 0.25 + 0.75 * clarity;
      for (const loop of pairs.high) loop?.gain.setTargetAtTime(LEVEL.high * open, now, 0.2);
    },
    destroy() {
      enabled = false;
      if (pairs) for (const loop of [...pairs.low, ...pairs.high]) loop?.stop();
      sound.destroy();
    },
  };
}
