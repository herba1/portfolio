import { label } from "../../../lib/sound/label.js";
import { pop, settle, tap, tick, whoosh } from "../../../lib/sound/recipes.js";

// A selection on glass: the handle catching each word is a light detent
// under the finger, lifting it is a soft release with a breath of air,
// setting it down a felt landing, and the callout pops up like a bubble.
export const takes = {
  tick: { count: 8, seed: 11, render: (sr, rand) => tick(sr, rand, { pitch: 1.15, weight: 0.12 }) },
  lift: { count: 4, seed: 12, render: (sr, rand) => tap(sr, rand, { pitch: 1.3, glass: 0.4 }) },
  air: { count: 3, seed: 13, render: (sr, rand) => whoosh(sr, rand, { length: 0.22, from: 900, to: 2600, q: 1.2 }) },
  settle: { count: 4, seed: 14, render: (sr, rand) => settle(sr, rand, { pitch: 1.5, air: 0.15 }) },
  pop: { count: 3, seed: 15, render: (sr, rand) => pop(sr, rand, { pitch: 760, length: 0.06, rise: 1.7 }) },
  whoosh: { count: 3, seed: 16, render: (sr, rand) => whoosh(sr, rand, { length: 0.34, from: 600, to: 2200, q: 1.1 }) },
};

label("lab/select/selectTakes", takes);
