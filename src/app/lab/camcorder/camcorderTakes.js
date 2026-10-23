import { label } from "../../../lib/sound/label.js";
import { BAR, body, jitter, PLATE, seamless, span, Take } from "../../../lib/sound/synth.js";
import { beep, tick } from "../../../lib/sound/recipes.js";

// A 2000s MiniDV camcorder in the hand: a piezo beeper, a tape transport
// that clamps and releases, a lens with a zoom motor and a focus stepper,
// a head drum spinning while the tape runs, and the noise of a playback
// head tracking the tape.

// Loops may start anywhere in their cycle: rotate to the quietest sample so
// the first pass does not begin on a step.
function quietStart(data) {
  let at = 0;
  for (let i = 1; i < data.length; i += 1) if (Math.abs(data[i]) < Math.abs(data[at])) at = i;
  const out = new Float32Array(data.length);
  out.set(data.subarray(at));
  out.set(data.subarray(0, at), data.length - at);
  return out;
}

// The transport engaging: a solenoid plunger slams home (hard, small, steel
// on steel), the pinch roller and loading arms thud into the chassis, and a
// lever latches a beat later.
function transport(sr, rand) {
  const t = new Take(sr, 0.2);
  const plunger = t.pulse(0.001, 0.00035 + rand() * 0.0001, 0.8);
  t.modes(plunger, body(1750 * jitter(rand, 0.05), BAR, { tau: 0.007, fall: 0.5, rand }));
  const arms = t.pulse(0.002 + rand() * 0.002, 0.0018 + rand() * 0.0008, 1);
  t.modes(arms, body(420 * jitter(rand, 0.05), PLATE.slice(0, 7), { tau: 0.022, fall: 0.9, gain: 0.8, rand, spread: 0.02 }));
  const latchAt = 0.05 + rand() * 0.015;
  const latch = t.pulse(latchAt, 0.0003, 0.4);
  t.modes(latch, body(1300 * jitter(rand, 0.06), BAR.slice(0, 3), { tau: 0.006, rand }));
  t.modes(latch, body(620 * jitter(rand, 0.05), PLATE.slice(0, 4), { tau: 0.008, gain: 0.4, rand }));
  return t.finish(0.9, 0.012);
}

// The zoom motor driving the lens group: a small DC motor's commutator buzz
// at its shaft rate (whole cycles in the loop) and the whine of the worm
// gear meshing, faster and higher as the rocker is pushed.
function zoomMotor(sr, rand) {
  const seconds = 1.05;
  const t = new Take(sr, seconds);
  const f = 210;
  const p = [rand(), rand(), rand(), rand()].map((x) => x * Math.PI * 2);
  for (let i = 0; i < t.n; i += 1) {
    const s = i / sr;
    const w = 2 * Math.PI * f * s;
    t.out[i] = 0.12 * Math.sin(w + p[0]) + 0.3 * Math.sin(2 * w + p[1]) + 0.35 * Math.sin(4 * w + p[2]) + 0.2 * Math.sin(6 * w + p[3]);
  }
  // Gear teeth: a click train at mesh rate ringing the plastic barrel.
  const mesh = new Float32Array(t.n);
  const teeth = f * 7;
  for (let k = 0; k < seconds * teeth; k += 1) {
    const at = Math.round((k / teeth) * sr + rand() * 3);
    if (at < t.n) mesh[at] = 0.5 + rand() * 0.5;
  }
  t.modes(mesh, [[1600 * jitter(rand, 0.03), 0.002, 0.5], [2500 * jitter(rand, 0.03), 0.0015, 0.35]]);
  t.add(t.noise(0, seconds, 0.08, rand, { lp: 0.5, hp: 0.1, curve: 0 }));
  return quietStart(seamless(t.finish(0.7, 0), sr, 0.05, { periodic: true }));
}

// The tape running: the head drum spins at 30 turns a second, so its
// bearing whirr and the guides' friction swell and fall at that rate; the
// capstan motor hums under it.
function tapeRun(sr, rand) {
  const seconds = 1.05;
  const t = new Take(sr, seconds);
  const whirr = t.noise(0, seconds, 1, rand, { lp: 0.12, hp: 0.04, curve: 0 });
  const swirl = new Float32Array(t.n);
  t.sweep(whirr, () => 520, 1.6, swirl);
  const drum = 30;
  for (let i = 0; i < t.n; i += 1) {
    const s = i / sr;
    const turn = 0.75 + 0.25 * Math.sin(2 * Math.PI * drum * s) + 0.1 * Math.sin(2 * Math.PI * drum * 2 * s + 1.3);
    t.out[i] = swirl[i] * turn + 0.12 * Math.sin(2 * Math.PI * 270 * s) + 0.08 * Math.sin(2 * Math.PI * 540 * s + 0.7);
  }
  return quietStart(seamless(t.finish(0.7, 0), sr, 0.05, { periodic: true }));
}

// Playback: the head reading the tape, hiss with a grain of dropouts and
// tracking glitches, kept in the band a small speaker plays.
function playHiss(sr, rand) {
  const seconds = 1.25;
  const t = new Take(sr, seconds);
  t.sweep(t.noise(0, seconds, 1, rand, { lp: 0.5, hp: 0.06, curve: 0 }), () => 2800, 0.9);
  const glitch = t.crackle(0, seconds, 30, 1, rand);
  t.modes(glitch, [[2100 * jitter(rand, 0.1), 0.003, 0.5], [3700 * jitter(rand, 0.1), 0.002, 0.3]]);
  return quietStart(seamless(t.finish(0.7, 0), sr));
}

export const takes = {
  // The piezo beeper behind the grille: 2.64 kHz, the same each time.
  beep: { count: 1, seed: 51, render: (sr, rand) => beep(sr, rand, { pitch: 2640, length: 0.075, buzz: 0.4 }) },
  clunk: { count: 5, seed: 52, render: transport },
  // The focus stepper ticking one step as the lens hunts.
  focus: { count: 5, seed: 53, render: (sr, rand) => tick(sr, rand, { pitch: 1.25 * span(rand, 0.95, 1.05), weight: 0.08 }) },
  zoom: { count: 1, seed: 54, loop: true, render: zoomMotor },
  tape: { count: 1, seed: 55, loop: true, render: tapeRun },
  hiss: { count: 1, seed: 56, loop: true, render: playHiss },
};

label("lab/camcorder/camcorderTakes", takes);
