import { label } from "../../../lib/sound/label.js";
import { jitter, Take } from "../../../lib/sound/synth.js";

// A soft struck tone for a ring arriving at its consonance: a felt mallet on
// a thick glass bar, nearly a sine. The fundamental and a twin a few cents
// off beat slowly; a faint octave and twelfth give it a body without a clang.
// Played at rate = the ring's interval, so a 3/2 ring sounds a fifth above.
export const F0 = 220;

function tone(sr, rand) {
  const t = new Take(sr, 3.2);
  const hit = t.pulse(0.002, 0.004 + rand() * 0.001);
  const f = F0 * jitter(rand, 0.002);
  t.modes(hit, [
    [f, 0.9, 1],
    [f * 1.0024, 0.8, 0.45],
    [f * 2.0, 0.32, 0.07],
    [f * 3.01, 0.14, 0.025],
  ]);
  return t.finish(0.8, 0.2);
}

export const takes = {
  tone: { count: 3, seed: 71, render: tone },
};

label("lab/musica-viva/musicaTakes", takes);
