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

// Breath across the words: a soft jet of air through the lips. Turbulence
// is broadband, but the mouth shapes it into a breathy "hhh" with a few
// broad resonances, and the jet wavers slowly as the flow is never steady.
// Looped and driven by how hard the pointer blows.
function breath(sr, rand) {
  const seconds = 3;
  const fade = 0.12;
  const t = new Take(sr, seconds + fade);
  const jet = t.noise(0, seconds + fade, 1, rand, { lp: 0.3, hp: 0.02, curve: 0 });
  // A slow random waver of the flow, a few times a second.
  let w = 0.6;
  let target = 0.6;
  for (let i = 0; i < t.n; i += 1) {
    if (i % Math.round(sr * 0.12) === 0) target = 0.45 + rand() * 0.55;
    w += (target - w) * 0.0004;
    jet[i] *= w;
  }
  const a = 620 * jitter(rand, 0.05);
  const b = 1250 * jitter(rand, 0.05);
  const c = 2500 * jitter(rand, 0.05);
  t.sweep(jet, () => a, 1.1, t.out, 0.7);
  t.sweep(jet, () => b, 1.6, t.out, 0.5);
  t.sweep(jet, () => c, 2.2, t.out, 0.22);
  return fromZero(seamless(t.finish(0.7, 0), sr, fade));
}

export const takes = {
  breath: { count: 1, seed: 801, loop: true, render: (sr, rand) => breath(sr, rand) },
};

label("lab/steam/steamTakes", takes);
