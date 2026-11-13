import { label } from "../../../lib/sound/label.js";
import { click, tick } from "../../../lib/sound/recipes.js";

// Two letters locking into one shape: a small, soft click, like two pieces
// of cut card seating against each other — low and short, with a little
// body under it. Parting is the same contact let go, quieter and higher.
export const takes = {
  lock: { count: 6, seed: 211, render: (sr, rand) => click(sr, rand, { pitch: 0.72, housing: 0.7 }) },
  part: { count: 6, seed: 212, render: (sr, rand) => tick(sr, rand, { pitch: 0.85, weight: 0.08, bright: 0.7 }) },
};

label("lab/ligature/ligatureTakes", takes);
