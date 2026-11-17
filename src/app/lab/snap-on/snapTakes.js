import { label } from "../../../lib/sound/label.js";
import { click, tick } from "../../../lib/sound/recipes.js";

// Machined parts: a steel slab seating against a stop is a hard, short
// contact with almost no body behind it, so the click is dry. A bar end
// catching at a letter's edge is the same detent, smaller. Knocking a fitting
// off is the release stroke, quieter and higher.
export const takes = {
  seat: { count: 6, seed: 431, render: (sr, rand) => click(sr, rand, { pitch: 1.18, housing: 0.28 }) },
  notch: { count: 6, seed: 432, render: (sr, rand) => tick(sr, rand, { pitch: 1.1, weight: 0.05, bright: 0.9 }) },
  pop: { count: 6, seed: 433, render: (sr, rand) => click(sr, rand, { pitch: 1.3, release: true, housing: 0.2 }) },
};

label("lab/snap-on/snapTakes", takes);
