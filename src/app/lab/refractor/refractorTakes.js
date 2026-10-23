import { PLATE, Take, body, jitter } from "../../../lib/sound/synth.js";

// A compact disc is a thin free plate of polycarbonate with a film of
// aluminium: flicked with a fingernail it gives a short, glassy shimmer of
// dense inharmonic modes (polycarbonate damps fast, so it never rings like
// metal), a dull knock where the thumb holds the hub, and the rim cutting the
// air as it turns past edge-on. Each riffle is the next disc flicked over.
function disc(sr, rand, { pitch = 1 } = {}) {
  const t = new Take(sr, 0.18);
  const nail = t.pulse(0.001, 0.00026 + rand() * 0.0001);
  t.modes(nail, body(1180 * pitch * jitter(rand, 0.05), PLATE, { tau: 0.028, fall: 0.85, tilt: 0.84, rand, spread: 0.025 }));
  const thumb = t.pulse(0.001, 0.0016 + rand() * 0.0006, 0.45);
  t.modes(thumb, body(430 * pitch * jitter(rand, 0.05), PLATE.slice(0, 4), { tau: 0.01, fall: 1, gain: 0.55, rand }));
  const rim = t.noise(0.004, 0.11, 0.07, rand, { lp: 0.45, hp: 0.12, curve: 3, attack: 0.03 });
  t.sweep(rim, (u) => 1400 + 1600 * Math.sin(Math.PI * Math.min(1, u * 1.4)), 1.6, t.out, 0.9);
  return t.finish(0.9, 0.012);
}

export const takes = {
  snap: { count: 6, seed: 301, render: (sr, rand) => disc(sr, rand) },
};
