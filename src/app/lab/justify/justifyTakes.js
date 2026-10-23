import { PLATE, Take, body, jitter } from "../../../lib/sound/synth.js";
import { key, tick } from "../../../lib/sound/recipes.js";

// A justified block being set by hand. Each word arriving in its line is a
// sort of wooden type dropped into a galley: a short, firm contact rings the
// small block bright and the galley tray knocks under it. Typing is a
// keyboard key; the softness control turns through detents.
function wordLands(sr, rand) {
  const t = new Take(sr, 0.08);
  const hit = t.pulse(0.001, 0.0007 + rand() * 0.0003, 1);
  t.modes(hit, body(1700 * jitter(rand, 0.06), PLATE.slice(0, 6), { tau: 0.005, fall: 0.6, gain: 0.8, rand, spread: 0.02 }));
  t.modes(hit, body(460 * jitter(rand, 0.1), PLATE.slice(0, 4), { tau: 0.008, fall: 0.9, gain: 0.3, rand, spread: 0.03 }));
  // The block rocks once on its feet as it settles.
  const rock = t.pulse(0.006 + rand() * 0.005, 0.0009, 0.22);
  t.modes(rock, body(1250 * jitter(rand, 0.06), PLATE.slice(0, 4), { tau: 0.004, rand }));
  return t.finish(0.85, 0.006);
}

export const takes = {
  tick: { count: 8, seed: 71, render: wordLands },
  key: { count: 8, seed: 72, render: (sr, rand) => key(sr, rand, { pitch: 1.05, cap: 0.9 }) },
  detent: { count: 5, seed: 73, render: (sr, rand) => tick(sr, rand, { pitch: 1.2, weight: 0.06 }) },
};
