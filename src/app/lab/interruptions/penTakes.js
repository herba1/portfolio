import { label } from "../../../lib/sound/label.js";
import { Take, body, jitter, PLATE } from "../../../lib/sound/synth.js";

// A plotter pen coming down on paper: a felt nib lands in a millisecond or
// two (soft, so only the low modes of the sheet and its board answer), with
// a faint dry tick from the pen holder's stop behind it.
function down(sr, rand) {
  const t = new Take(sr, 0.05);
  // Where on the sheet it lands changes which modes of the board answer, and
  // the holder's stop catches a little early or late.
  const land = t.pulse(0.001, 0.0012 + rand() * 0.0012);
  t.modes(land, body(380 * jitter(rand, 0.2), PLATE.slice(0, 4), { tau: 0.004 + rand() * 0.004, fall: 0.9, gain: 0.8, rand, spread: 0.06 }));
  const stop = t.pulse(0.0012 + rand() * 0.0015, 0.0003, 0.15 + rand() * 0.2);
  t.modes(stop, [[2900 * jitter(rand, 0.15), 0.0012, 0.4], [4700 * jitter(rand, 0.15), 0.0008, 0.2]]);
  t.add(t.noise(0.001, 0.012, 0.03 + rand() * 0.05, rand, { lp: 0.35, hp: 0.08, curve: 6 }));
  return t.finish(0.8, 0.006);
}

export const takes = {
  down: { count: 6, seed: 1968, render: (sr, rand) => down(sr, rand) },
};

label("lab/interruptions/penTakes", takes);
