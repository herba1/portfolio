import { label } from "../../../lib/sound/label.js";
import { BAR, PLATE, Take, body, jitter } from "../../../lib/sound/synth.js";

// A drum falling into its notch. A spring-loaded steel pawl rides up the
// ridge between two notches (a faint lift tick) and drops onto the next
// flank: a hard, sub-millisecond steel contact that rings the pawl like a
// short bar, and a heavier, slower push that knocks the wheel itself, a
// dense plastic hub on a spindle, low and dead. No ring-out: the wheel is
// stopped, so the body is damped fast.
function detent(sr, rand) {
  const t = new Take(sr, 0.09);
  const drop = 0.005 + rand() * 0.003;
  const lift = t.pulse(0.001, 0.0003, 0.12 * jitter(rand, 0.3));
  t.modes(lift, body(3400 * jitter(rand, 0.06), BAR.slice(0, 3), { tau: 0.0018, fall: 0.8, rand }));
  const strike = t.pulse(drop, 0.00022 * jitter(rand, 0.15));
  t.modes(strike, body(2650 * jitter(rand, 0.05), BAR, { tau: 0.0032, fall: 0.9, gain: 0.9, tilt: 0.6, rand, spread: 0.04 }));
  const knock = t.pulse(drop, 0.0011 * jitter(rand, 0.15));
  t.modes(knock, body(780 * jitter(rand, 0.05), PLATE.slice(0, 6), { tau: 0.0065, fall: 0.8, gain: 0.7, tilt: 0.7, rand, spread: 0.03 }));
  t.modes(knock, body(190 * jitter(rand, 0.12), PLATE.slice(0, 3), { tau: 0.011, fall: 1, gain: 0.22, tilt: 0.6, rand, spread: 0.05 }));
  t.add(t.noise(drop, 0.008, 0.05, rand, { lp: 0.55, hp: 0.15, curve: 6 }));
  return t.finish(0.9, 0.01);
}

export const takes = {
  detent: { count: 8, seed: 1931, render: (sr, rand) => detent(sr, rand) },
};

label("lab/drum/detentTakes", takes);
