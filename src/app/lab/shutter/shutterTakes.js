import { label } from "../../../lib/sound/label.js";
import { BAR, body, jitter, PLATE, span, Take } from "../../../lib/sound/synth.js";

// A focal-plane shutter on bulb. Pressing fires half of it: the mirror flips
// up and slaps its foam stop, and the first curtain releases with a hard,
// bright click. The exposure then runs as long as the finger stays down.
// Letting go fires the other half: the second curtain slams shut and its
// spring rings, and the mirror drops back with a softer, lower knock.

const BODY = 420;

function open(sr, rand) {
  const t = new Take(sr, 0.16);
  const slap = t.pulse(0.002, 0.0014 + rand() * 0.0003, 0.8);
  t.modes(slap, body(BODY * jitter(rand, 0.05), PLATE.slice(0, 6), { tau: 0.014, fall: 0.9, gain: 0.5, rand }));
  const curtain = t.pulse(0.006 + span(rand, 0, 0.002), 0.00025, 0.75);
  t.modes(curtain, body(2300 * jitter(rand, 0.05), BAR, { tau: 0.011, fall: 0.5, rand }));
  t.modes(curtain, body(5100 * jitter(rand, 0.05), BAR.slice(0, 3), { tau: 0.005, gain: 0.45, rand }));
  t.add(t.noise(0.002, 0.03, 0.1, rand, { lp: 0.7, hp: 0.15, curve: 4 }));
  return t.finish(0.85, 0.01);
}

function close(sr, rand) {
  const t = new Take(sr, 0.2);
  const curtain = t.pulse(0.002, 0.0002, 1);
  t.modes(curtain, body(2150 * jitter(rand, 0.05), BAR, { tau: 0.014, fall: 0.5, rand }));
  t.modes(curtain, body(4800 * jitter(rand, 0.05), BAR.slice(0, 3), { tau: 0.007, gain: 0.5, rand }));
  const spring = t.crackle(0.004, 0.02, 1400, 0.1, rand, (u) => 1 - u);
  t.modes(spring, [[3300 * jitter(rand, 0.05), 0.004, 0.4]]);
  const mirror = t.pulse(0.03 + span(rand, 0, 0.006), 0.0018, 0.55);
  t.modes(mirror, body(BODY * 0.85 * jitter(rand, 0.05), PLATE.slice(0, 5), { tau: 0.016, fall: 0.9, gain: 0.45, rand }));
  t.add(t.noise(0.002, 0.02, 0.08, rand, { lp: 0.6, hp: 0.15, curve: 4 }));
  return t.finish(0.9, 0.012);
}

export const takes = {
  open: { count: 4, seed: 71, render: open },
  close: { count: 4, seed: 72, render: close },
};

label("lab/shutter/shutterTakes", takes);
