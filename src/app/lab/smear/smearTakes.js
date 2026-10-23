import { label } from "../../../lib/sound/label.js";
import { body, jitter, PLATE, seamless, Take } from "../../../lib/sound/synth.js";

// The poem is set in small paper slips that slide across a dark table.
// Moving, they rub: a soft drag of paper over felt with the odd fibre
// catching. Each slip coming to rest is a light card set down — a light, quick
// contact, a short papery ring and a dull knock from the table.

function quietStart(data) {
  let at = 0;
  for (let i = 1; i < data.length; i += 1) if (Math.abs(data[i]) < Math.abs(data[at])) at = i;
  const out = new Float32Array(data.length);
  out.set(data.subarray(at));
  out.set(data.subarray(0, at), data.length - at);
  return out;
}

function slide(sr, rand) {
  const seconds = 1.65;
  const t = new Take(sr, seconds);
  const rub = t.noise(0, seconds, 1, rand, { lp: 0.35, hp: 0.03, curve: 0 });
  // Paper over felt: the band a dragged sheet speaks in, slowly wandering.
  t.sweep(rub, (u) => 1100 * (1 + 0.25 * Math.sin(2 * Math.PI * 3 * u) + 0.12 * Math.sin(2 * Math.PI * 7 * u + 1)), 0.9);
  const fibres = t.crackle(0, seconds, 160, 1, rand);
  t.modes(fibres, [[2300 * jitter(rand, 0.1), 0.0012, 0.35], [3900 * jitter(rand, 0.1), 0.0008, 0.25]]);
  return quietStart(seamless(t.finish(0.7, 0), sr));
}

function land(sr, rand) {
  const t = new Take(sr, 0.07);
  const hit = t.pulse(0.001, 0.0003 + rand() * 0.00015, 1);
  t.modes(hit, [
    [2500 * jitter(rand, 0.1), 0.003, 0.6],
    [3700 * jitter(rand, 0.1), 0.002, 0.4],
  ]);
  t.modes(hit, body(520 * jitter(rand, 0.06), PLATE.slice(0, 4), { tau: 0.006, fall: 0.9, gain: 0.25, rand, spread: 0.04 }));
  t.add(t.noise(0.001, 0.02, 0.08, rand, { lp: 0.4, hp: 0.08, curve: 5 }));
  return t.finish(0.85, 0.006);
}

export const takes = {
  slide: { count: 1, seed: 81, loop: true, render: slide },
  land: { count: 8, seed: 82, render: land },
};

label("lab/smear/smearTakes", takes);
