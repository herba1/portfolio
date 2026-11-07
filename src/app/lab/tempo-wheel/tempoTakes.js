import { label } from "../../../lib/sound/label.js";
import { BAR, PLATE, Take, body, jitter } from "../../../lib/sound/synth.js";
import { tick } from "../../../lib/sound/recipes.js";

// A clockwork metronome's escapement: a small hard pallet strikes the
// escape wheel (bright, a few milliseconds) and the wooden case knocks once
// under it. Kept short and soft so it sits behind the room, not in front.
function beat(sr, rand) {
  const t = new Take(sr, 0.08);
  const hit = t.pulse(0.001, 0.00028 + rand() * 0.00008, 1);
  t.modes(hit, body(1900 * jitter(rand, 0.025), BAR, { tau: 0.0055, fall: 0.55, rand, spread: 0.01 }));
  const knock = t.pulse(0.0012, 0.0011 + rand() * 0.0003, 0.42);
  t.modes(knock, body(540 * jitter(rand, 0.03), PLATE.slice(0, 5), { tau: 0.011, fall: 0.8, gain: 0.7, rand }));
  return t.finish(0.9, 0.006);
}

export const takes = {
  beat: { count: 6, seed: 211, render: beat },
  detent: { count: 6, seed: 212, render: (sr, rand) => tick(sr, rand, { pitch: 1.35, weight: 0.015, bright: 1.1 }) },
};

label("lab/tempo-wheel/tempoTakes", takes);
