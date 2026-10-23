import { BAR, PLATE, Take, body, jitter } from "../../../lib/sound/synth.js";
import { seamless } from "../../../lib/sound/engine.js";

// A manual lens's aperture ring over a nine-blade iris. The ring clicks
// through its stops on a sprung ball: a firm detent at each full stop and a
// lighter one at each third. Turning it slides nine thin blackened-steel
// blades over each other, a fine, dry, bright scrape that stops dead when
// the ring stops. Both sit in the same aluminium barrel.

const BARREL = 1250;

function loopable(data, sr, fadeSeconds = 0.05) {
  const s = seamless(data, sr, fadeSeconds);
  let best = 0;
  let bestV = Infinity;
  for (let i = 1; i < s.length; i += 1) {
    if (s[i - 1] <= 0 && s[i] > 0 && Math.abs(s[i]) < bestV) {
      bestV = Math.abs(s[i]);
      best = i;
    }
  }
  const out = new Float32Array(s.length);
  out.set(s.subarray(best));
  out.set(s.subarray(0, best), s.length - best);
  return out;
}

// A full stop: the ball drops into a deep notch — a hard, short contact on
// the spring arm, a firm knock of the ring on the barrel, and the blades
// shiver for a moment as the ring halts.
function full(sr, rand) {
  const t = new Take(sr, 0.07);
  const drop = t.pulse(0.001, 0.0002 + rand() * 0.00008);
  t.modes(drop, body(2900 * jitter(rand, 0.05), BAR, { tau: 0.005, fall: 0.55, rand, spread: 0.02 }));
  const knock = t.pulse(0.001, 0.0009 + rand() * 0.0004, 0.8);
  t.modes(knock, body(BARREL * jitter(rand, 0.03), PLATE.slice(0, 6), { tau: 0.01, fall: 0.7, gain: 0.55, rand }));
  t.modes(knock, body(560 * jitter(rand, 0.04), PLATE.slice(0, 3), { tau: 0.012, fall: 1, gain: 0.3, rand }));
  const shiver = t.crackle(0.003, 0.012, 1800, 0.12, rand, (u) => 1 - u);
  t.modes(shiver, [
    [3600 * jitter(rand, 0.06), 0.0008, 0.5],
    [5200 * jitter(rand, 0.06), 0.0005, 0.3],
  ]);
  return t.finish(0.9, 0.005);
}

// A third stop: a shallow notch, so a smaller, brighter tick with only a
// trace of the barrel.
function third(sr, rand) {
  const t = new Take(sr, 0.045);
  const drop = t.pulse(0.001, 0.00016 + rand() * 0.00006);
  t.modes(drop, body(3400 * jitter(rand, 0.05), BAR, { tau: 0.0035, fall: 0.6, rand, spread: 0.02 }));
  const knock = t.pulse(0.001, 0.0008 + rand() * 0.0003, 0.3);
  t.modes(knock, body(BARREL * jitter(rand, 0.03), PLATE.slice(0, 4), { tau: 0.007, fall: 0.7, gain: 0.4, rand }));
  return t.finish(0.9, 0.004);
}

// The blades sliding: dense, tiny contacts between thin steel leaves, each
// ringing the leaf's high, quickly damped modes, over a little dry air.
function blades(sr, rand) {
  const seconds = 2.4;
  const t = new Take(sr, seconds);
  const grit = t.crackle(0, seconds, 2200, 1, rand);
  t.modes(grit, [
    [2300 * jitter(rand, 0.04), 0.0012, 0.55],
    [3500 * jitter(rand, 0.04), 0.0009, 0.45],
    [4700 * jitter(rand, 0.04), 0.0006, 0.25],
    [BARREL * jitter(rand, 0.03), 0.002, 0.25],
  ]);
  const air = t.noise(0, seconds, 0.06, rand, { lp: 0.4, hp: 0.08, curve: 0 });
  t.sweep(air, () => 2600, 1.2, t.out, 1);
  return loopable(t.finish(0.7, 0), sr);
}

export const takes = {
  full: { count: 6, seed: 51, render: full },
  third: { count: 6, seed: 52, render: third },
  blades: { count: 1, seed: 53, loop: true, render: blades },
};
