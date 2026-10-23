import { label } from "../../lib/sound/label.js";
import { body, jitter, PLATE, seamless, span, Take } from "../../lib/sound/synth.js";


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

// A photo print burning. Resin-coated paper is a paper core sealed in
// polyethylene under a gelatin emulsion: as the flame front reaches it the
// fibres snap, the plastic blisters, and pockets of gas burst. Each of those
// is a tiny, hard event (a fraction of a millisecond) ringing the stiff
// sheet for a moment, so a crackle is bright and dry, never a "tss".

// One crackle event. Most are fibre snaps (tiny, high), some are blisters
// bursting (a slightly softer pop with a little body of the sheet behind).
function snap(sr, rand, index) {
  const t = new Take(sr, 0.05);
  const blister = index % 3 === 2;
  const hit = t.pulse(0.0008, blister ? 0.0005 + rand() * 0.0003 : 0.00015 + rand() * 0.0001);
  const f = (blister ? 1500 : 2600) * jitter(rand, 0.18);
  t.modes(hit, [
    [f, blister ? 0.0035 : 0.0018, 0.6],
    [f * span(rand, 1.5, 1.9), 0.0012, 0.45],
    [f * span(rand, 2.3, 2.8), 0.0008, 0.25],
  ]);
  if (blister) t.modes(hit, body(520 * jitter(rand, 0.1), PLATE.slice(0, 3), { tau: 0.005, fall: 1, gain: 0.45, rand }));
  return t.finish(0.9, 0.004);
}

// The flame itself: a sheet of burning paper gives a soft, low roar from the
// turbulent plume (the combustion noise sits a few hundred hertz up, rising
// and falling as the flame licks) with a fine bed of crackle inside it.
function flame(sr, rand) {
  const seconds = 2.6;
  const fade = 0.1;
  const t = new Take(sr, seconds + fade);
  const plume = t.noise(0, seconds + fade, 1, rand, { lp: 0.22, hp: 0.01, curve: 0 });
  let lick = 0.6;
  let target = 0.6;
  for (let i = 0; i < t.n; i += 1) {
    if (i % Math.round(sr * 0.09) === 0) target = 0.35 + rand() * 0.65;
    lick += (target - lick) * 0.0006;
    plume[i] *= lick;
  }
  t.sweep(plume, (u) => 420 + 160 * Math.sin(u * Math.PI * 6 + 1), 0.9, t.out, 0.55);
  t.sweep(plume, () => 1100, 1.4, t.out, 0.25);
  const fine = t.crackle(0, seconds + fade, 140, 0.5, rand);
  t.modes(fine, [
    [2300 * jitter(rand, 0.1), 0.0012, 0.5],
    [3900 * jitter(rand, 0.1), 0.0008, 0.35],
  ]);
  return fromZero(seamless(t.finish(0.7, 0), sr, fade));
}

// Catching fire: the flame takes the sheet all at once. Air rushes in to
// feed it (a band of noise that rises fast and falls as the flame steadies),
// the hot gas expands with a soft low puff, and the first fibres go.
function flare(sr, rand) {
  const length = 0.55 + rand() * 0.08;
  const t = new Take(sr, length + 0.04);
  const rush = t.noise(0, length, 1, rand, { lp: 0.8, hp: 0.01, curve: 0 });
  for (let i = 0; i < t.n; i += 1) {
    const u = i / (length * sr);
    rush[i] *= u < 1 ? Math.min(1, u / 0.09) * Math.exp(-u * 3.2) : 0;
  }
  const peak = 2200 * jitter(rand, 0.1);
  t.sweep(rush, (u) => (u < 0.3 ? 360 * Math.pow(peak / 360, u / 0.3) : peak * Math.pow(700 / peak, Math.min(1, (u - 0.3) / 0.7))), 1.1, t.out, 0.55);
  const puff = t.pulse(0.004, 0.004 + rand() * 0.002, 0.12);
  t.modes(puff, body(310 * jitter(rand, 0.06), PLATE.slice(0, 5), { tau: 0.025, fall: 1, tilt: 0.75, gain: 0.1, rand }));
  const first = t.crackle(0.04, length * 0.8, 90, 1, rand, (u) => 1 - u);
  t.modes(first, [[2500 * jitter(rand, 0.1), 0.0014, 0.5], [4100 * jitter(rand, 0.1), 0.0009, 0.3]]);
  return t.finish(0.85, 0.03);
}

export const takes = {
  snap: { count: 9, seed: 901, render: (sr, rand, i) => snap(sr, rand, i) },
  flame: { count: 1, seed: 902, loop: true, render: (sr, rand) => flame(sr, rand) },
  flare: { count: 4, seed: 903, render: (sr, rand) => flare(sr, rand) },
};

label("scorch/scorchTakes", takes);
