import { PLATE, Take, body, jitter } from "../../../lib/sound/synth.js";

// Flipping through a crate of records: each sleeve that passes the middle is
// the edge of one cardboard jacket slapping the next. Card is soft and
// lossy, so the contact is half a millisecond and the board rings for only
// a few, with a breath of paper scuff behind it.
function sleeve(sr, rand) {
  const t = new Take(sr, 0.06);
  const edge = t.pulse(0.001, 0.0005 + rand() * 0.0002);
  t.modes(edge, body(1150 * jitter(rand, 0.07), PLATE.slice(0, 7), { tau: 0.006, fall: 0.7, tilt: 0.78, rand, spread: 0.03 }));
  t.modes(edge, body(420 * jitter(rand, 0.06), PLATE.slice(0, 3), { tau: 0.008, fall: 1, gain: 0.4, rand }));
  t.add(t.noise(0.001, 0.018, 0.09, rand, { lp: 0.5, hp: 0.12, curve: 5 }));
  return t.finish(0.9, 0.006);
}

// A sleeve turning over to its back: the jacket sweeps through the air (a
// band of noise that rises as it speeds up and falls as it slows), the board
// flexes with a faint crackle of card, and it lands on its back face with a
// soft tap.
function turn(sr, rand) {
  const length = 0.2 + rand() * 0.03;
  const t = new Take(sr, length + 0.06);
  const air = t.noise(0, length, 1, rand, { lp: 0.8, hp: 0.02, curve: 0 });
  for (let i = 0; i < t.n; i += 1) air[i] *= Math.sin(Math.PI * Math.min(1, i / (length * sr))) ** 2;
  t.sweep(air, (u) => 700 * Math.pow(2600 / 700, Math.sin(Math.PI * Math.min(1, u * 1.15))), 1.3, t.out, 0.35);
  const flex = t.crackle(0.02, length * 0.8, 320, 1.4, rand, (u) => Math.sin(Math.PI * u));
  t.modes(flex, [[1700 * jitter(rand, 0.1), 0.0015, 0.4], [3100 * jitter(rand, 0.1), 0.001, 0.3]]);
  const land = t.pulse(length * 0.92, 0.0012, 0.5);
  t.modes(land, body(520 * jitter(rand, 0.06), PLATE.slice(0, 4), { tau: 0.008, fall: 1, gain: 0.6, rand }));
  return t.finish(0.85, 0.02);
}

export const takes = {
  tick: { count: 8, seed: 701, render: (sr, rand) => sleeve(sr, rand) },
  flick: { count: 4, seed: 702, render: (sr, rand) => turn(sr, rand) },
};
