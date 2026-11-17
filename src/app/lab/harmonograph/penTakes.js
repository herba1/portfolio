import { label } from "../../../lib/sound/label.js";
import { jitter, seamless, Take } from "../../../lib/sound/synth.js";

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

// A fine nib running over cotton paper: a dry, high hiss where the steel
// rides the surface, a thin grain of ticks as it crosses the fibres, and a
// faint body from the sheet itself. Looped; the piece drives its level and
// rate from how fast the pen moves over the paper.
function nib(sr, rand) {
  const seconds = 2.4;
  const fade = 0.1;
  const t = new Take(sr, seconds + fade);
  const hiss = t.noise(0, seconds + fade, 1, rand, { lp: 0.32, hp: 0.07, curve: 0 });
  // The pressure is never quite steady.
  let w = 0.7;
  let target = 0.7;
  for (let i = 0; i < t.n; i += 1) {
    if (i % Math.round(sr * 0.05) === 0) target = 0.5 + rand() * 0.5;
    w += (target - w) * 0.002;
    hiss[i] *= w;
  }
  const a = 2400 * jitter(rand, 0.04);
  const b = 4800 * jitter(rand, 0.04);
  t.sweep(hiss, () => a, 1.4, t.out, 0.55);
  t.sweep(hiss, () => b, 1.8, t.out, 0.16);
  const fibre = t.crackle(0, seconds + fade, 900, 0.5, rand);
  t.sweep(fibre, () => 1900 * jitter(rand, 0.02), 2.5, t.out, 0.45);
  const body = t.noise(0, seconds + fade, 0.25, rand, { lp: 0.08, hp: 0.01, curve: 0 });
  t.sweep(body, () => 700, 1.2, t.out, 0.35);
  return fromZero(seamless(t.finish(0.7, 0), sr, fade));
}

export const takes = {
  nib: { count: 1, seed: 1207, loop: true, render: (sr, rand) => nib(sr, rand) },
};

label("lab/harmonograph/penTakes", takes);
