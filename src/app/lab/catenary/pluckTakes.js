import { label } from "../../../lib/sound/label.js";
import { Take, jitter } from "../../../lib/sound/synth.js";

// A taut overhead steel wire, plucked by hand at a distance of a few metres.
// Two things reach the ear. The string itself: its audible partials are its
// high harmonics, packed close (the fundamental is about one hertz), with a
// little stiffness spreading them, so they read as a dry metallic thrum that
// dies in a few tenths of a second. And the wire as a waveguide: a stiff
// cable is dispersive, high frequencies run along it faster than low ones,
// so the pulse arrives back from the insulator as a quick falling chirp (the
// "pew" of a struck guy wire), then again, fainter, from the far support.
// Both are kept low and short: a soft fingertip contact, nothing ringing.

function chirp(t, at, amp, rand, { hi = 2600, lo = 260, tau = 0.045, dur = 0.16 } = {}) {
  const sr = t.sr;
  const x = new Float32Array(t.n);
  const i0 = t.index(at);
  const len = Math.round(dur * sr);
  let ph = rand() * 6.28;
  for (let i = 0; i < len && i0 + i < t.n; i += 1) {
    const s = i / sr;
    const f = lo + (hi - lo) * Math.exp(-s / tau);
    ph += (2 * Math.PI * f) / sr;
    // Rises over a millisecond, fades as the high end runs out.
    const env = Math.min(1, s / 0.0012) * Math.exp(-s / (dur * 0.32));
    x[i0 + i] = Math.sin(ph) * env * amp;
  }
  return x;
}

function pluck(sr, rand) {
  const t = new Take(sr, 0.9);
  // Fingertip contact: soft, ~5 ms, so only the lower partials are reached.
  const touch = t.pulse(0.002, 0.005 * jitter(rand, 0.2));
  const f0 = 52 * jitter(rand, 0.04);
  const B = 0.00045;
  const list = [];
  for (let n = 2; n <= 26; n += 1) {
    const f = n * f0 * Math.sqrt(1 + B * n * n);
    list.push([f * jitter(rand, 0.004), 0.42 * Math.pow(n / 2, -0.55), Math.pow(n / 2, -0.7) * (0.6 + 0.4 * rand())]);
  }
  t.modes(touch, list);
  // The waveguide chirps: from the near insulator, then the far support.
  const back = 0.055 * jitter(rand, 0.15);
  t.add(chirp(t, 0.004 + back, 0.05, rand, { hi: 2300 * jitter(rand, 0.08), lo: 240, tau: 0.04 }));
  t.add(chirp(t, 0.004 + back * 2.6, 0.022, rand, { hi: 1700 * jitter(rand, 0.08), lo: 220, tau: 0.05 }));
  // A breath of air against the hand.
  t.add(t.noise(0.0, 0.03, 0.03, rand, { lp: 0.25, hp: 0.04, curve: 5 }));
  return t.finish(0.85, 0.05);
}

export const takes = {
  pluck: { count: 6, seed: 7741, render: (sr, rand) => pluck(sr, rand) },
};

label("lab/catenary/pluckTakes", takes);
