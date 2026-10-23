import { createSound } from "@/lib/sound/engine";
import { CHORDS, takes } from "./fieldTakes";

// The wind is pre-rendered loops (fieldTakes.js) driven by the field: as the
// characters gather, the wind swells, its band and whistle climb with the
// rate, and the aeolian chord for the word fades up as the picture holds.
const WIND = ["body", "rush", "whistle"];
const HARPS = CHORDS.map((_, k) => `harp${k}`);

export function createFieldSound() {
  const sound = createSound({ level: -6, room: 0.18, on: false });
  if (!sound.ctx) return null;
  const bank = Object.fromEntries(Object.entries(takes).map(([name, spec]) => [name, sound.bank(spec.render, spec)]));
  const loops = {};

  let enabled = false;
  let gust = 0;
  let gustTarget = 0;
  let gustAt = 0;
  let chordIndex = 0;

  const ramp = (param, value, tau) => {
    param.setTargetAtTime(value, sound.ctx.currentTime, tau);
  };

  // Each layer starts silent and begins to sound once the worker has
  // rendered its take; nothing is rendered on the frame of the gesture.
  const startLayers = () => {
    for (const name of [...WIND, ...HARPS]) if (!loops[name]) loops[name] = sound.loop(bank[name]);
  };

  const silence = (tau) => {
    const now = sound.ctx.currentTime;
    for (const loop of Object.values(loops)) {
      if (!loop) continue;
      loop.gain.cancelScheduledValues(now);
      loop.gain.setTargetAtTime(0, now, tau);
    }
  };

  return {
    async setEnabled(on) {
      enabled = on;
      if (on) {
        const ok = await sound.setEnabled(true);
        return ok && enabled;
      }
      silence(0.08);
      await new Promise((r) => setTimeout(r, 300));
      if (!enabled) await sound.setEnabled(false);
      return false;
    },
    chord(i) {
      chordIndex = i % CHORDS.length;
    },
    update({ swell, hold, stir, clock }) {
      if (!enabled || !sound.live) return;
      startLayers();
      if (clock > gustAt) {
        gustAt = clock + 0.8 + Math.random() * 1.6;
        gustTarget = Math.random();
      }
      gust += (gustTarget - gust) * 0.02;
      const s = Math.min(1, swell * 0.85 + stir * 0.6 + gust * 0.18);
      if (loops.body) {
        ramp(loops.body.gain, 0.22 + 0.7 * s, 0.3);
        // The body's band sits at 380 Hz at rate 1: 260 Hz in a lull, near
        // 800 Hz in a full gale, as before.
        ramp(loops.body.rate, (260 + 520 * s + 80 * gust) / 380, 0.4);
      }
      if (loops.rush) {
        ramp(loops.rush.gain, 0.04 + 0.55 * s * s + 0.06 * gust, 0.25);
        ramp(loops.rush.rate, 0.85 + 0.35 * s, 0.4);
      }
      if (loops.whistle) {
        ramp(loops.whistle.gain, 0.04 + 0.5 * s * s + 0.12 * stir, 0.35);
        ramp(loops.whistle.rate, Math.min(2, (640 + 900 * s + 160 * gust) / 700), 0.6);
      }
      HARPS.forEach((name, k) => {
        if (loops[name]) ramp(loops[name].gain, k === chordIndex ? 0.75 * hold : 0, k === chordIndex ? 0.5 : 0.25);
      });
    },
    destroy() {
      enabled = false;
      silence(0.03);
      for (const loop of Object.values(loops)) loop?.stop();
      sound.destroy();
    },
  };
}
