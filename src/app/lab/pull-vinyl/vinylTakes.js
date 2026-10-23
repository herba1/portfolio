import { label } from "../../../lib/sound/label.js";
import { jitter, seamless, span, Take } from "../../../lib/sound/synth.js";


// A loop has no start, so begin it where the wave crosses zero: rotating a
// seamless loop keeps it seamless, and the first play starts from silence.
function fromZero(data) {
  let best = 0;
  for (let i = 1; i < data.length; i += 1) if (Math.abs(data[i]) < Math.abs(data[best])) best = i;
  const out = new Float32Array(data.length);
  out.set(data.subarray(best));
  out.set(data.subarray(0, best), data.length - best);
  return out;
}

// A record drawn out of (or back into) its paper inner sleeve: the paper's
// fibres catch and let go against the vinyl in a dense run of tiny contacts
// that swell and fade with the pull, each ringing the sleeve's stiff paper
// briefly, under a soft rustle of the sleeve flexing.
function sleeve(sr, rand, { length = 0.3 } = {}) {
  const t = new Take(sr, length + 0.04);
  const shape = (u) => Math.sin(Math.PI * Math.min(1, u)) ** 1.3;
  const fibres = t.crackle(0.002, length, 2200, 1, rand, shape);
  t.modes(fibres, [
    [880 * jitter(rand, 0.08), 0.004, 0.35],
    [1650 * jitter(rand, 0.08), 0.0025, 0.5],
    [2900 * jitter(rand, 0.08), 0.0014, 0.45],
    [4400 * jitter(rand, 0.08), 0.0009, 0.25],
  ]);
  const rustle = t.noise(0.002, length, 0.05, rand, { lp: 0.35, hp: 0.05, curve: 0.5, attack: length * 0.35 });
  t.sweep(rustle, (u) => 900 + 900 * u, 1.2, t.out, 1);
  return t.finish(0.85, 0.02);
}

// Surface noise of a spinning record, one revolution at 33 1/3 rpm long
// (1.8 s), so the scratch and the dust that pop once a turn pop again on
// the next turn, the way a real record's do. Fine dust is a run of tiny
// clicks through the stylus and cartridge; a scratch is a louder, slightly
// longer pop; the groove itself is a low, soft hiss.
function surface(sr, rand) {
  const turn = 1.8;
  const fade = 0.05;
  const t = new Take(sr, turn + fade);
  const dust = t.crackle(0, turn + fade, 38, 0.35, rand);
  const pops = dust;
  const scratches = 2 + Math.floor(rand() * 2);
  for (let k = 0; k < scratches; k += 1) {
    const at = span(rand, 0.06, turn - 0.06);
    const p = t.pulse(at, 0.00025 + rand() * 0.0002, 0.7 + rand() * 0.3);
    for (let i = 0; i < t.n; i += 1) pops[i] += p[i];
  }
  t.modes(pops, [
    [1500 * jitter(rand, 0.05), 0.0016, 0.5],
    [3200 * jitter(rand, 0.05), 0.0011, 0.6],
    [5400 * jitter(rand, 0.05), 0.0007, 0.35],
  ]);
  t.modes(pops, [[620 * jitter(rand, 0.05), 0.004, 0.25]]);
  t.add(t.noise(0, turn + fade, 0.035, rand, { lp: 0.4, hp: 0.06, curve: 0 }));
  return fromZero(seamless(t.finish(0.8, 0), sr, fade));
}

export const takes = {
  slide: { count: 4, seed: 501, render: (sr, rand) => sleeve(sr, rand, { length: span(rand, 0.26, 0.32) }) },
  surface: { count: 1, seed: 502, loop: true, render: (sr, rand) => surface(sr, rand) },
};

label("lab/pull-vinyl/vinylTakes", takes);
