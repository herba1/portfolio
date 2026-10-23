import { BAR, PLATE, Take, body, jitter } from "../../../lib/sound/synth.js";
import { seamless } from "../../../lib/sound/engine.js";

// A manual focus lens, from its parts. The ring turns a helicoid packed in
// damping grease; under the ring a sprung steel ball rides over a ribbed
// track and drops into each groove; at either end of travel a tab on the
// helicoid meets a brass stop pin. All of it is mounted in a long aluminium
// barrel, which is what gives every part of it the same hollow colour.

// The barrel: a thin aluminium tube, its first ring modes.
const BARREL = 1150;

// A seamless loop cut where it crosses zero, so it starts on silence.
function loopable(data, sr, fadeSeconds = 0.06) {
  const s = seamless(data, sr, fadeSeconds);
  let best = 0;
  let bestV = Infinity;
  for (let i = 1; i < s.length; i += 1) {
    if (s[i - 1] <= 0 && s[i] > 0 && Math.abs(s[i]) < bestV) {
      bestV = Math.abs(s[i]);
      best = i;
    }
  }
  const out = new Float32Array(s.length);
  out.set(s.subarray(best));
  out.set(s.subarray(0, best), s.length - best);
  return out;
}

// The ball dropping into a groove: a tiny, hard steel contact (a fifth of a
// millisecond), so the spring arm rings bright and briefly; the barrel
// answers underneath, hollow and short. The ball rides up the ridge first,
// a faint scrape a few ms before the drop.
function detent(sr, rand) {
  const t = new Take(sr, 0.05);
  const ride = t.noise(0.001, 0.004 + rand() * 0.002, 0.05, rand, { lp: 0.55, hp: 0.12, curve: 1.5, attack: 0.003 });
  t.modes(ride, [[2600 * jitter(rand, 0.08), 0.0012, 0.6]]);
  const at = 0.005 + rand() * 0.002;
  const drop = t.pulse(at, 0.00016 + rand() * 0.00008);
  t.modes(drop, body(3300 * jitter(rand, 0.05), BAR, { tau: 0.0035, fall: 0.6, rand, spread: 0.02 }));
  const knock = t.pulse(at, 0.0007 + rand() * 0.0003, 0.6);
  t.modes(knock, body(BARREL * jitter(rand, 0.03), PLATE.slice(0, 5), { tau: 0.008, fall: 0.7, gain: 0.45, rand }));
  return t.finish(0.9, 0.004);
}

// Grease: viscous, smooth shear with no hard contacts, so a soft band of
// noise low in the barrel's register, and very sparse grit where the
// helicoid's thread catches.
function grease(sr, rand) {
  const seconds = 3;
  const t = new Take(sr, seconds);
  const src = t.noise(0, seconds, 1, rand, { lp: 0.35, hp: 0.02, curve: 0 });
  const ph = rand() * Math.PI * 2;
  t.sweep(src, (u) => 520 * (1 + 0.12 * Math.sin(2 * Math.PI * 3 * u + ph)), 1.1);
  const grit = t.crackle(0, seconds, 140, 0.35, rand);
  t.modes(grit, [
    [1700 * jitter(rand, 0.05), 0.0015, 0.5],
    [BARREL * jitter(rand, 0.03), 0.004, 0.35],
  ]);
  return loopable(t.finish(0.7, 0), sr);
}

// The end stop: the helicoid tab meets the brass pin. The grease cushions
// it (a contact near a millisecond), so the barrel thunks rather than
// rings, with the pin's own short ping on top.
function stop(sr, rand) {
  const t = new Take(sr, 0.16);
  const hit = t.pulse(0.001, 0.0007 + rand() * 0.0003);
  t.modes(hit, body(390 * jitter(rand, 0.04), PLATE, { tau: 0.03, fall: 0.85, tilt: 0.78, rand, spread: 0.02 }));
  t.modes(hit, body(BARREL * jitter(rand, 0.03), PLATE.slice(0, 4), { tau: 0.012, fall: 0.6, gain: 0.5, rand }));
  const pin = t.pulse(0.0012, 0.00025, 0.5);
  t.modes(pin, body(1800 * jitter(rand, 0.05), BAR, { tau: 0.009, fall: 0.5, rand }));
  return t.finish(0.9, 0.01);
}

export const takes = {
  detent: { count: 8, seed: 41, render: detent },
  grease: { count: 1, seed: 42, loop: true, render: grease },
  stop: { count: 4, seed: 43, render: stop },
};
