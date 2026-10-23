import { beep } from "../../../lib/sound/recipes.js";
import { BAR, PLATE, Take, body, jitter, span } from "../../../lib/sound/synth.js";

// The tracker keeps its own 122 bpm pulse, so the beat is a small kit and
// the lock-ons are the HUD's own beeps.

// A drum: the beater lands on a tensioned head (a millisecond of felt, then a
// hard click from the beater's face), the head rings on a circular
// membrane's modes, and its pitch sags as the struck tension relaxes. The
// fundamental is tuned where a laptop can still play it; the click and the
// upper modes carry the punch. `size` scales the drum.
function drum(sr, rand, { pitch = 1, size = 1, click = 0.35 } = {}) {
  const t = new Take(sr, 0.12 + 0.18 * size);
  const f0 = 150 * pitch * jitter(rand, 0.03);
  // The sag: a decaying sine whose pitch falls by a fifth over the first beat.
  const n = t.n;
  let phase = 0;
  const glide = 0.05 * size;
  const tau = 0.07 * size;
  for (let i = 0; i < n; i += 1) {
    const s = i / sr;
    const f = f0 * (1 + 0.5 * Math.exp(-s / glide));
    phase += (2 * Math.PI * f) / sr;
    const env = Math.min(1, s / 0.0015) * Math.exp(-s / tau);
    t.out[i] += 0.55 * Math.sin(phase) * env;
  }
  const felt = t.pulse(0.0005, 0.0012 + rand() * 0.0004, 1);
  t.modes(felt, body(f0 * 1.15, PLATE.slice(1, 8), { tau: 0.05 * size, fall: 1.1, tilt: 0.78, gain: 0.7, rand, spread: 0.02 }));
  const face = t.pulse(0.0005, 0.00022 + rand() * 0.00008, click);
  t.modes(face, body(2900 * jitter(rand, 0.06), BAR.slice(0, 3), { tau: 0.004, gain: 9, rand }));
  t.add(t.noise(0.0005, 0.012, 0.3 * click, rand, { lp: 0.6, hp: 0.15, curve: 5 }));
  return t.finish(0.9, 0.02);
}

// A closed hi-hat: two thin bronze cymbals clamped together, so the stick's
// tip excites a dense cloud of inharmonic modes that the clamp chokes in a
// few tens of milliseconds. Kept under 8 kHz so it reads on small speakers
// as metal rather than fizz.
function hat(sr, rand, { open = 1 } = {}) {
  const t = new Take(sr, 0.09);
  const tip = t.pulse(0.0005, 0.00018 + rand() * 0.00006);
  const list = [];
  for (let i = 0; i < 16; i += 1) list.push([span(rand, 2900, 7600), (0.006 + rand() * 0.012) * open, 0.5 + rand() * 0.5]);
  t.modes(tip, list);
  t.add(t.noise(0.0005, 0.03 * open, 0.25, rand, { lp: 0.7, hp: 0.3, curve: 5 }));
  return t.finish(0.85, 0.008);
}

export const takes = {
  drop: { count: 3, seed: 401, render: (sr, rand) => drum(sr, rand, { size: 1.2, click: 0.45 }) },
  knock: { count: 4, seed: 402, render: (sr, rand) => drum(sr, rand, { pitch: 1.2, size: 0.55, click: 0.3 }) },
  hat: { count: 6, seed: 403, render: (sr, rand) => hat(sr, rand) },
  // Rendered at one pitch and played at a rate: acquire tunes by box size.
  lock: { count: 4, seed: 404, render: (sr, rand) => beep(sr, rand, { pitch: 2400 * jitter(rand, 0.01), length: 0.026, buzz: 0.3 }) },
  lose: { count: 3, seed: 405, render: (sr, rand) => beep(sr, rand, { pitch: 1250 * jitter(rand, 0.01), length: 0.02, buzz: 0.45 }) },
};
