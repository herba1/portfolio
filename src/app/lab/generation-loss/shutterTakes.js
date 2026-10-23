import { label } from "../../../lib/sound/label.js";
import { shutter } from "../../../lib/sound/recipes.js";
import { span } from "../../../lib/sound/synth.js";

// Every save is a photograph of the last photograph: a small SLR firing.
// The mirror flips up and slaps its stop, the first curtain releases with a
// hard click, the exposure passes, the second curtain slams shut and its
// spring rings. The exposure is a little different each take, as a
// mechanical shutter's is, so a run of saves never machine-guns.
export const takes = {
  shutter: {
    count: 6,
    seed: 61,
    render: (sr, rand) => shutter(sr, rand, { exposure: span(rand, 0.034, 0.05), mirror: span(rand, 0.45, 0.65) }),
  },
};

label("lab/generation-loss/shutterTakes", takes);
