import { label } from "../../../lib/sound/label.js";
import { PLATE, Take, body, jitter, span } from "../../../lib/sound/synth.js";

// A resin-coated photo print being crushed. It is stiffer and glossier than
// writing paper, so it does not hiss: it buckles. Each new crease is a
// sudden snap-through of a facet (a cluster of a few hard micro-contacts in
// a couple of milliseconds) that rings the facet's own short, bright modes,
// with the flex of the whole sheet thudding softly underneath. Each held
// stop-motion frame also carries the crinkle of every existing crease
// rubbing against its neighbours.

// One facet snapping through. `size` (0..1) is the facet: big early folds
// ring lower and carry more of the sheet; fine late creases are small and
// bright.
function snap(size) {
  return (sr, rand) => {
    const t = new Take(sr, 0.06);
    const x = new Float32Array(t.n);
    const events = 2 + Math.floor(rand() * 4);
    for (let e = 0; e < events; e += 1) {
      const p = t.pulse(0.001 + rand() * 0.0025, 0.00012 + rand() * 0.0001, (0.4 + 0.6 * rand()) * (rand() < 0.5 ? -1 : 1));
      for (let i = 0; i < t.n; i += 1) x[i] += p[i];
    }
    const f = (1700 + 1900 * (1 - size)) * jitter(rand, 0.12);
    t.modes(x, [
      [f, 0.0025, 0.6],
      [f * span(rand, 1.5, 1.8), 0.0018, 0.45],
      [f * span(rand, 2.3, 2.7), 0.001, 0.25],
    ]);
    // The sheet flexing: a soft, wide push that only rings the low modes.
    const flex = t.pulse(0.001, 0.002 + rand() * 0.001, 0.22 * size);
    t.modes(flex, body(480 * jitter(rand, 0.1), PLATE.slice(0, 4), { tau: 0.01, fall: 1, gain: 0.7, rand, spread: 0.04 }));
    return t.finish(0.9, 0.006);
  };
}

// The crinkle of a held frame: many small snaps inside a soft rustle,
// shaped as a squeeze that rises and lets go over about 120 ms.
function crinkle(sr, rand) {
  const length = 0.12 + rand() * 0.03;
  const t = new Take(sr, length + 0.03);
  const shape = (u) => Math.sin(Math.PI * Math.min(1, u)) ** 1.2;
  const snaps = t.crackle(0.002, length, 700, 1, rand, shape);
  t.modes(snaps, [
    [1900 * jitter(rand, 0.1), 0.0013, 0.6],
    [3100 * jitter(rand, 0.1), 0.001, 0.5],
    [4600 * jitter(rand, 0.1), 0.0006, 0.25],
  ]);
  const flex = t.noise(0.002, length, 0.12, rand, { lp: 0.18, hp: 0.03, curve: 1.5, attack: length * 0.25 });
  t.modes(flex, body(520 * jitter(rand, 0.08), PLATE.slice(0, 3), { tau: 0.006, fall: 1, gain: 0.5, rand }));
  return t.finish(0.85, 0.02);
}

export const takes = {
  snapBig: { count: 6, seed: 71, render: snap(0.9) },
  snapSmall: { count: 8, seed: 72, render: snap(0.2) },
  crinkle: { count: 6, seed: 73, render: crinkle },
};

label("lab/crumple/crumpleTakes", takes);
