import { label } from "../../../lib/sound/label.js";
import { BAR, PLATE, Take, body, jitter } from "../../../lib/sound/synth.js";
import { beep } from "../../../lib/sound/recipes.js";

// A candybar phone: a rubber-dome keypad under a hard plastic keymat, and a
// tiny earpiece speaker that answers every press with a keytone.

// A thumb on a key: the pad of the thumb is soft, so it thumps the keymat
// and the shell; the rubber dome collapses a few ms later with a muffled
// snap (rubber damps it fast); the cap bottoms on the board.
function keypad(sr, rand) {
  const t = new Take(sr, 0.09);
  const thumb = t.pulse(0.001, 0.0022 + rand() * 0.001, 0.5);
  t.modes(thumb, body(520 * jitter(rand, 0.06), PLATE.slice(0, 5), { tau: 0.008, fall: 0.9, gain: 0.45, rand }));
  const domeAt = 0.003 + rand() * 0.003;
  const dome = t.pulse(domeAt, 0.0005 + rand() * 0.0002, 0.7);
  t.modes(dome, body(1900 * jitter(rand, 0.06), PLATE.slice(0, 6), { tau: 0.003, fall: 0.6, rand, spread: 0.02 }));
  const floor = t.pulse(domeAt + 0.0015, 0.0004, 0.5);
  t.modes(floor, body(1150 * jitter(rand, 0.05), PLATE.slice(0, 4), { tau: 0.005, fall: 0.8, gain: 0.6, rand }));
  // The dome springs back as the thumb lifts: softer, a touch higher.
  const back = t.pulse(domeAt + 0.03 + rand() * 0.012, 0.0005, 0.16);
  t.modes(back, body(2300 * jitter(rand, 0.06), BAR.slice(0, 3), { tau: 0.003, rand }));
  return t.finish(0.9, 0.006);
}

// A soft tone through a tiny earpiece: a near-sine with a few odd partials
// and a quick attack, coloured by the speaker's resonance.
function earcon(sr, rand, notes) {
  const t = new Take(sr, 0.36);
  const x = new Float32Array(t.n);
  for (const [freq, at, length] of notes) {
    const f = freq * jitter(rand, 0.002);
    const i0 = Math.round(at * sr);
    const n = Math.round(length * sr);
    let phase = rand() * Math.PI * 2;
    const w = (2 * Math.PI * f) / sr;
    for (let i = 0; i < n && i0 + i < t.n; i += 1) {
      const s = i / sr;
      const env = Math.min(1, s / 0.004) * Math.exp(-s / (length * 0.32)) * (i > n - 240 ? (n - i) / 240 : 1);
      phase += w;
      x[i0 + i] += (Math.sin(phase) + 0.18 * Math.sin(3 * phase) + 0.05 * Math.sin(5 * phase)) * env;
    }
  }
  t.add(x, 0.7);
  t.modes(x, [[2900 * jitter(rand, 0.02), 0.0015, 0.08], [4600, 0.001, 0.04]]);
  return t.finish(0.8, 0.02);
}

export const takes = {
  key: { count: 8, seed: 41, render: keypad },
  // The keytone: about 1.3 kHz out of the earpiece, short. A phone's
  // keytone is generated, so it really is the same every time: one take.
  tone: { count: 1, seed: 42, render: (sr, rand) => beep(sr, rand, { pitch: 1320, length: 0.045, buzz: 0.35 }) },
  // Message sent: two rising notes, a fifth apart.
  sent: { count: 3, seed: 43, render: (sr, rand) => earcon(sr, rand, [[1046.5, 0.001, 0.17], [1568, 0.091, 0.24]]) },
};

label("lab/t9/t9Takes", takes);
