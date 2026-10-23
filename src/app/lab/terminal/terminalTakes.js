import { BAR, PLATE, Take, body, jitter, span } from "../../../lib/sound/synth.js";
import { thunk } from "../../../lib/sound/recipes.js";
import { seamless } from "../../../lib/sound/engine.js";

// A seamless loop may start anywhere in its cycle: start it where it is
// quietest, so the first sample of the first pass is not a step.
function quietStart(data) {
  let at = 0;
  for (let i = 1; i < data.length; i += 1) if (Math.abs(data[i]) < Math.abs(data[at])) at = i;
  const out = new Float32Array(data.length);
  out.set(data.subarray(at));
  out.set(data.subarray(0, at), data.length - at);
  return out;
}

// A 1983 terminal on a desk: a CRT in a plastic case and a heavy keyboard.
// The text types itself out, so each character is a key of that keyboard
// going down: a buckling spring snaps, its hammer slaps the switch plate and
// the coil pings faintly, all inside a steel-backed case that thuds low.
function springKey(sr, rand) {
  const t = new Take(sr, 0.11);
  // Fingertip on a deep, sculpted cap: soft, so it only thumps the case.
  const finger = t.pulse(0.001, 0.002 + rand() * 0.001, 0.3);
  t.modes(finger, body(330 * jitter(rand, 0.06), PLATE.slice(0, 5), { tau: 0.012, fall: 0.9, gain: 0.5, rand }));
  // The spring buckles a few ms into travel: a hard, tiny contact.
  const snapAt = 0.004 + rand() * 0.003;
  const snap = t.pulse(snapAt, 0.00022 + rand() * 0.0001, 0.8);
  t.modes(snap, body(2300 * jitter(rand, 0.05), BAR, { tau: 0.006, fall: 0.5, rand }));
  // The hammer lands on the plate under the switch.
  const slap = t.pulse(snapAt + 0.0015 + rand() * 0.001, 0.0006, 0.7);
  t.modes(slap, body(1050 * jitter(rand, 0.05), PLATE.slice(0, 7), { tau: 0.008, fall: 0.7, gain: 0.8, rand }));
  // The coil keeps ringing quietly after the strike.
  t.modes(snap, [[3600 * jitter(rand, 0.04), 0.03, 0.05], [5100 * jitter(rand, 0.04), 0.018, 0.025]]);
  // The return stroke: the cap tops out against its guide.
  const back = t.pulse(snapAt + 0.045 + rand() * 0.015, 0.0004, 0.18);
  t.modes(back, body(1700 * jitter(rand, 0.06), BAR.slice(0, 3), { tau: 0.004, rand }));
  return t.finish(0.9, 0.008);
}

// The cursor relay behind the menu: a small armature pulled in, a hard
// snap over a light plastic frame.
function relay(sr, rand) {
  const t = new Take(sr, 0.06);
  const pull = t.pulse(0.001, 0.0005, 0.35);
  const snap = t.pulse(0.0025 + rand() * 0.0015, 0.0002 + rand() * 0.00008, 1);
  t.modes(snap, body(2700 * jitter(rand, 0.06), BAR, { tau: 0.004, fall: 0.6, rand, spread: 0.02 }));
  const both = new Float32Array(t.n);
  for (let i = 0; i < t.n; i += 1) both[i] = pull[i] + snap[i] * 0.5;
  t.modes(both, body(780 * jitter(rand, 0.05), PLATE.slice(0, 5), { tau: 0.006, fall: 0.8, gain: 0.4, rand }));
  return t.finish(0.9, 0.005);
}

// Power on: the switch clacks, the degaussing coil buzzes the whole chassis
// at mains harmonics and dies away, and the tube charges with a crackle of
// static across the glass.
function powerOn(sr, rand) {
  const t = new Take(sr, 0.9);
  const clack = t.pulse(0.002, 0.0004, 0.12);
  t.modes(clack, body(1500 * jitter(rand, 0.05), BAR, { tau: 0.008, rand }));
  t.modes(clack, body(260 * jitter(rand, 0.05), PLATE.slice(0, 6), { tau: 0.03, fall: 0.9, gain: 0.7, rand }));
  const mains = 60 * jitter(rand, 0.004);
  const start = Math.round(0.012 * sr);
  const phases = Array.from({ length: 16 }, () => rand() * Math.PI * 2);
  for (let i = start; i < t.n; i += 1) {
    const s = (i - start) / sr;
    const env = Math.min(1, s / 0.015) * Math.exp(-s / 0.22);
    let v = 0;
    // The chassis rattles, so its harmonics sit high, around the panels'
    // own ring, where a small speaker can carry them.
    for (let h = 3; h < 19; h += 1) v += (Math.sin(2 * Math.PI * mains * h * s + phases[h - 3]) / h) * (h % 2 ? 1 : 0.6);
    t.out[i] += v * env * 0.6;
  }
  const charge = t.crackle(0.03, 0.6, 220, 0.15, rand, (u) => Math.exp(-u * 3));
  t.modes(charge, [[2600 * jitter(rand, 0.1), 0.0012, 0.4], [4300 * jitter(rand, 0.1), 0.0008, 0.3]]);
  return t.finish(0.9, 0.06);
}

// The set warm: the transformer hums at mains harmonics (whole cycles in the
// loop, so it repeats without a seam) with a little breath of fan air.
function hum(sr, rand) {
  const seconds = 1.05;
  const t = new Take(sr, seconds);
  const f = 60;
  const p = [rand(), rand(), rand(), rand(), rand()].map((x) => x * Math.PI * 2);
  for (let i = 0; i < t.n; i += 1) {
    const s = i / sr;
    t.out[i] =
      0.2 * Math.sin(2 * Math.PI * f * 2 * s + p[0]) +
      0.45 * Math.sin(2 * Math.PI * f * 4 * s + p[1]) +
      0.3 * Math.sin(2 * Math.PI * f * 6 * s + p[2]) +
      0.18 * Math.sin(2 * Math.PI * f * 8 * s + p[3]) +
      0.08 * Math.sin(2 * Math.PI * f * 11 * s + p[4]);
  }
  t.add(t.noise(0, seconds, 0.12, rand, { lp: 0.3, hp: 0.05, curve: 0 }));
  return quietStart(seamless(t.finish(0.7, 0), sr));
}

// The cover being drawn: the beam sweeps lines, each a tiny click at the
// line rate, ringing a band of the case and coil; played faster as the
// raster climbs.
function raster(sr, rand) {
  const seconds = 1.05;
  const t = new Take(sr, seconds);
  const lines = t.crackle(0, seconds, 40, 0.3, rand);
  const rate = span(rand, 238, 246);
  for (let k = 0; k < seconds * rate; k += 1) {
    const at = Math.round((k / rate) * sr + rand() * 6);
    if (at < t.n) lines[at] += 0.6 + rand() * 0.4;
  }
  t.modes(lines, [
    [1150, 0.004, 0.6],
    [1720, 0.003, 0.4],
    [2900, 0.002, 0.25],
  ]);
  t.add(t.noise(0, seconds, 0.08, rand, { lp: 0.45, hp: 0.1, curve: 0 }));
  return quietStart(seamless(t.finish(0.7, 0), sr));
}

export const takes = {
  key: { count: 8, seed: 31, render: springKey },
  tick: { count: 6, seed: 32, render: relay },
  clunk: { count: 4, seed: 33, render: (sr, rand) => thunk(sr, rand, { pitch: 1.6, latch: 0.8, size: 0.75 }) },
  power: { count: 2, seed: 34, render: powerOn },
  hum: { count: 1, seed: 35, loop: true, render: hum },
  raster: { count: 1, seed: 36, loop: true, render: raster },
};
