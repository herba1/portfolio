import { jitter, seamless, span, Take } from "../../../lib/sound/synth.js";

// The stylus meeting a scratch: a contact far shorter than a millisecond,
// ringing the cartridge and cantilever briefly. A fine hairline is a dry
// tick; a deep cut is a pop, a wider push that reaches the low body too.
function tick(sr, rand) {
  const t = new Take(sr, 0.03);
  const p = t.pulse(0.0005, span(rand, 0.00008, 0.00016), 1);
  t.modes(p, [
    [2600 * jitter(rand, 0.12), 0.0011, 0.55],
    [5200 * jitter(rand, 0.12), 0.0007, 0.6],
    [8400 * jitter(rand, 0.1), 0.0004, 0.3],
  ]);
  t.add(t.noise(0.0004, 0.004, 0.25, rand, { lp: 0.8, hp: 0.2, curve: 6 }));
  return t.finish(0.9, 0.004);
}

function pop(sr, rand) {
  const t = new Take(sr, 0.07);
  const p = t.pulse(0.0005, span(rand, 0.0004, 0.0008), 1);
  t.modes(p, [
    [380 * jitter(rand, 0.15), 0.007, 0.7],
    [1250 * jitter(rand, 0.1), 0.0025, 0.5],
    [3300 * jitter(rand, 0.1), 0.0012, 0.45],
  ]);
  t.add(p, 0.6);
  t.add(t.noise(0.0004, 0.01, 0.3, rand, { lp: 0.6, hp: 0.08, curve: 5 }));
  return t.finish(0.9, 0.006);
}

// The groove under the stylus with nothing on it yet: a low hiss and a
// thin run of dust, one revolution long so it can loop.
function surface(sr, rand) {
  const turn = 1.8;
  const fade = 0.05;
  const t = new Take(sr, turn + fade);
  const dust = t.crackle(0, turn + fade, 22, 0.25, rand);
  t.modes(dust, [
    [1700 * jitter(rand, 0.05), 0.0014, 0.5],
    [4300 * jitter(rand, 0.05), 0.0008, 0.5],
  ]);
  t.add(t.noise(0, turn + fade, 0.05, rand, { lp: 0.35, hp: 0.05, curve: 0 }));
  return seamless(t.finish(0.7, 0), sr, fade);
}

export const takes = {
  tick: { count: 6, seed: 811, render: (sr, rand) => tick(sr, rand) },
  pop: { count: 4, seed: 812, render: (sr, rand) => pop(sr, rand) },
  surface: { count: 1, seed: 813, loop: true, render: (sr, rand) => surface(sr, rand) },
};
