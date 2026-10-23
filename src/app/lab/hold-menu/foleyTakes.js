import { click, tick } from "../../../lib/sound/recipes.js";
import { PLATE, Take, body, jitter } from "../../../lib/sound/synth.js";

// A 12-inch cardboard jacket lifting off the shelf: fingers pinch it (a soft,
// several-millisecond contact), the board's broad panel thumps on its low
// modes, and the edge leaves the shelf with a short scuff of card on wood.
function lift(sr, rand) {
  const t = new Take(sr, 0.16);
  const pinch = t.pulse(0.001, 0.0022 + rand() * 0.0008);
  t.modes(pinch, body(330 * jitter(rand, 0.06), PLATE.slice(0, 6), { tau: 0.02, fall: 1, tilt: 0.8, rand, spread: 0.02 }));
  const edge = t.pulse(0.006 + rand() * 0.004, 0.0005, 0.8);
  t.modes(edge, body(1300 * jitter(rand, 0.06), PLATE.slice(0, 5), { tau: 0.005, fall: 0.7, gain: 4, rand }));
  t.add(t.noise(0.004, 0.05, 0.12, rand, { lp: 0.4, hp: 0.08, curve: 4, attack: 0.008 }));
  return t.finish(0.9, 0.012);
}

// The menu itself is glass under the finger: crossing a row is a light
// detent and choosing a row is a small switch snapping over.
export const takes = {
  thunk: { count: 4, seed: 601, render: (sr, rand) => lift(sr, rand) },
  tick: { count: 8, seed: 602, render: (sr, rand) => tick(sr, rand, { pitch: 0.9, weight: 0.12 }) },
  pick: { count: 4, seed: 603, render: (sr, rand) => click(sr, rand, { pitch: 0.85, housing: 0.8 }) },
};
