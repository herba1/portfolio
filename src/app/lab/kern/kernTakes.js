import { BAR, PLATE, Take, body, jitter } from "../../../lib/sound/synth.js";
import { tick, whoosh } from "../../../lib/sound/recipes.js";

// Every letter is a sort of metal type tied to its neighbours by springs.
// Picking one up, letting it go, a spring snapping it past home, and setting
// a new sort in the line are each the sound of that small object.

// Pinching a sort: fingertip and nail on a small lead block. A short bright
// ring from the metal over a dull knock of the block itself.
function grab(sr, rand) {
  const t = new Take(sr, 0.07);
  const nail = t.pulse(0.001, 0.00045 + rand() * 0.00015, 0.7);
  t.modes(nail, body(3100 * jitter(rand, 0.05), BAR, { tau: 0.005, fall: 0.5, rand }));
  const pad = t.pulse(0.002, 0.0016 + rand() * 0.0006, 1);
  t.modes(pad, body(880 * jitter(rand, 0.05), PLATE.slice(0, 5), { tau: 0.007, fall: 0.8, gain: 0.5, rand }));
  return t.finish(0.85, 0.006);
}

// Letting go: the coil spring rings — its partials sit close and slightly
// stretched, and a released spring's pitch drops as its tension relaxes in
// the first moments — and the sort knocks its neighbour as it lands.
function twang(sr, rand) {
  const t = new Take(sr, 0.32);
  const f = 360 * jitter(rand, 0.06);
  const partials = [1, 2.08, 3.21, 4.4, 5.65].map((r, i) => [f * r * jitter(rand, 0.005), 0.16 / (1 + i * 0.7), 0.6 / (1 + i * 0.5)]);
  const phases = partials.map(() => rand() * Math.PI * 2);
  for (let i = 0; i < t.n; i += 1) {
    const s = i / sr;
    const attack = Math.min(1, s / 0.0015);
    let v = 0;
    for (let k = 0; k < partials.length; k += 1) {
      const [pf, tau, g] = partials[k];
      // Integrated phase of a frequency that settles from pf*1.18 to pf.
      const ph = 2 * Math.PI * pf * (s + 0.18 * 0.035 * (1 - Math.exp(-s / 0.035))) + phases[k];
      v += Math.sin(ph) * g * Math.exp(-s / tau);
    }
    t.out[i] += v * attack * 0.5;
  }
  const knock = t.pulse(0.008 + rand() * 0.01, 0.0012, 0.9);
  t.modes(knock, body(640 * jitter(rand, 0.05), PLATE.slice(0, 5), { tau: 0.01, fall: 0.8, gain: 0.7, rand }));
  t.modes(knock, body(2400 * jitter(rand, 0.06), BAR.slice(0, 3), { tau: 0.004, gain: 0.3, rand }));
  return t.finish(0.85, 0.03);
}

// Setting a new sort in the stick: lead on steel, a hard little clack with
// the stick ringing briefly under it.
function setSort(sr, rand) {
  const t = new Take(sr, 0.08);
  const hit = t.pulse(0.001, 0.0003 + rand() * 0.0001, 1);
  t.modes(hit, body(2200 * jitter(rand, 0.05), BAR, { tau: 0.007, fall: 0.6, rand }));
  t.modes(hit, body(620 * jitter(rand, 0.05), PLATE.slice(0, 6), { tau: 0.012, fall: 0.8, gain: 0.6, rand }));
  const settle = t.pulse(0.006 + rand() * 0.004, 0.0008, 0.25);
  t.modes(settle, body(1300 * jitter(rand, 0.06), PLATE.slice(0, 4), { tau: 0.005, rand }));
  return t.finish(0.9, 0.006);
}

export const takes = {
  grab: { count: 5, seed: 61, render: grab },
  release: { count: 6, seed: 62, render: twang },
  // A sort springing past its home: the spring's coil ticks against itself.
  settle: { count: 8, seed: 63, render: (sr, rand) => tick(sr, rand, { pitch: 0.95, weight: 0.12 }) },
  key: { count: 6, seed: 64, render: setSort },
  // The cut changing weight: air drawn across the line, rising to heavy,
  // falling back to regular.
  heavier: { count: 3, seed: 65, render: (sr, rand) => whoosh(sr, rand, { length: 0.56, from: 380, to: 1300, q: 1.4, up: true }) },
  lighter: { count: 3, seed: 66, render: (sr, rand) => whoosh(sr, rand, { length: 0.56, from: 420, to: 1500, q: 1.4, up: false }) },
};
