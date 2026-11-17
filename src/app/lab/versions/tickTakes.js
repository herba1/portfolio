import { label } from "../../../lib/sound/label.js";
import { PLATE, Take, body, jitter } from "../../../lib/sound/synth.js";

// A version settling into place: the soft tick of a stiff card dropping into
// a slot. A brief, light contact (a fingertip on card, not steel on steel)
// rings a thin plate for a couple of milliseconds, with a breath of paper
// fibre on top. Small and dry, so twelve in a row read as a ratchet, not a
// drum roll.
function tick(sr, rand) {
  const t = new Take(sr, 0.05);
  const at = 0.002;
  const tap = t.pulse(at, 0.00045 * jitter(rand, 0.2), 0.8 * jitter(rand, 0.1));
  t.modes(tap, body(1850 * jitter(rand, 0.05), PLATE.slice(0, 6), { tau: 0.0024, fall: 0.85, gain: 0.8, tilt: 0.65, rand, spread: 0.04 }));
  t.modes(tap, body(420 * jitter(rand, 0.08), PLATE.slice(0, 3), { tau: 0.004, fall: 0.9, gain: 0.28, tilt: 0.6, rand, spread: 0.05 }));
  t.add(t.noise(at, 0.006, 0.04, rand, { lp: 0.5, hp: 0.2, curve: 6 }));
  return t.finish(0.8, 0.008);
}

export const takes = {
  tick: { count: 8, seed: 4021, render: (sr, rand) => tick(sr, rand) },
};

label("lab/versions/tickTakes", takes);
