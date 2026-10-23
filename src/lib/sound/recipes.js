// Takes for the sounds interfaces make, each modelled from what physically
// makes it: what strikes, how long the contact lasts, what rings and for how
// long, and what the air adds. Every recipe is render(sampleRate, rand, opts)
// and returns a Float32Array, so a client can bank it:
//
//   const ticks = sound.bank((sr, rand) => tick(sr, rand, { pitch: 1.2 }), { count: 8 });
//
// Levels are normalised per take; set loudness at play time, in dB.

import { BAR, BELL, PLATE, Take, body, jitter, span } from "./synth.js";

// A detent or a ratchet pawl dropping into a tooth: a hard, tiny contact on
// a small stiff part, so almost all of it is above 2 kHz and gone in a few
// milliseconds, over a faint knock from whatever it is mounted in.
export function tick(sr, rand, { pitch = 1, weight = 0.03, bright = 1 } = {}) {
  const t = new Take(sr, 0.06);
  const hit = t.pulse(0.001, (0.00018 + rand() * 0.00008) / bright);
  const f1 = 2900 * pitch * jitter(rand, 0.06);
  t.modes(hit, body(f1, BAR, { tau: 0.005, fall: 0.6, rand, spread: 0.015 }));
  const knock = t.pulse(0.001, 0.0012 + rand() * 0.0006, weight);
  t.modes(knock, body(640 * pitch * jitter(rand, 0.05), PLATE.slice(0, 4), { tau: 0.005, gain: 0.8, rand }));
  return t.finish(0.9, 0.004);
}

// A switch or a plastic button: the press lands, then the mechanism snaps
// over a few milliseconds later, brighter; a housing rings low under both.
// `release` renders the softer return stroke instead.
export function click(sr, rand, { pitch = 1, release = false, housing = 1 } = {}) {
  const t = new Take(sr, 0.09);
  const scale = release ? 0.55 : 1;
  const press = t.pulse(0.001, 0.0009 + rand() * 0.0004, 0.5 * scale);
  const snapAt = 0.001 + (release ? 0.004 : 0.007) + rand() * 0.003;
  const snap = t.pulse(snapAt, 0.00022 + rand() * 0.0001, scale);
  const f1 = (release ? 2100 : 2600) * pitch * jitter(rand, 0.05);
  t.modes(snap, body(f1, BAR, { tau: 0.006, fall: 0.5, rand }));
  const shell = new Float32Array(t.n);
  for (let i = 0; i < t.n; i += 1) shell[i] = press[i] + snap[i] * 0.4;
  t.modes(shell, body(900 * pitch * jitter(rand, 0.04), PLATE.slice(0, 6), { tau: 0.008, fall: 0.8, gain: 0.35 * housing, rand }));
  return t.finish(0.9, 0.006);
}

// A key under a fingertip: the pad of the finger is soft (a few ms of
// contact, so it thumps rather than clicks), the keycap rings as hollow
// plastic, and the key bottoms out and returns with a small tick.
export function key(sr, rand, { pitch = 1, travel = 0.03, cap = 1 } = {}) {
  const t = new Take(sr, 0.12);
  const finger = t.pulse(0.001, 0.0018 + rand() * 0.0008, 0.6);
  t.modes(finger, body(380 * pitch * jitter(rand, 0.06), PLATE.slice(0, 5), { tau: 0.01, fall: 0.9, gain: 0.4, rand }));
  const bottom = t.pulse(0.004 + rand() * 0.002, 0.0005, 0.9 * cap);
  t.modes(bottom, body(1250 * pitch * jitter(rand, 0.05), PLATE.slice(0, 7), { tau: 0.007, fall: 0.6, rand }));
  const back = t.pulse(0.004 + travel + rand() * 0.008, 0.0003, 0.22);
  t.modes(back, body(2400 * pitch * jitter(rand, 0.05), BAR.slice(0, 3), { tau: 0.004, rand }));
  return t.finish(0.9, 0.006);
}

// A heavy mechanism: a door, a carriage, a cassette clamp. A slow, soft
// contact rings a big body for tens of milliseconds; a latch clicks into it.
export function thunk(sr, rand, { pitch = 1, latch = 1, size = 1 } = {}) {
  const t = new Take(sr, 0.28 * size);
  const hit = t.pulse(0.001, 0.0022 + rand() * 0.001, 1);
  t.modes(hit, body(220 * pitch * jitter(rand, 0.05), PLATE, { tau: 0.035 * size, fall: 0.9, tilt: 0.8, rand, spread: 0.02 }));
  t.add(t.noise(0.001, 0.02, 0.3, rand, { lp: 0.45, hp: 0.05, curve: 5 }));
  if (latch) {
    const at = 0.012 + rand() * 0.012;
    const catchX = t.pulse(at, 0.0003, 0.55 * latch);
    t.modes(catchX, body(1900 * pitch * jitter(rand, 0.06), BAR, { tau: 0.008, rand }));
  }
  return t.finish(0.9, 0.012);
}

// A fingertip on glass or a hard screen: soft contact, a short bright ring
// from the glass, a dull knock from the frame behind it.
export function tap(sr, rand, { pitch = 1, glass = 1 } = {}) {
  const t = new Take(sr, 0.08);
  const hit = t.pulse(0.001, 0.0006 + rand() * 0.0003, 1);
  t.modes(hit, body(1450 * pitch * jitter(rand, 0.06), PLATE.slice(0, 6), { tau: 0.006, fall: 0.5, gain: 0.9 * glass, rand }));
  t.modes(hit, body(420 * pitch * jitter(rand, 0.05), PLATE.slice(0, 3), { tau: 0.008, fall: 1, gain: 0.45, rand }));
  return t.finish(0.85, 0.006);
}

// Something soft landing: a felt hammer, a card on a table, a word set
// down. Long contact, so only low modes speak, with a breath of air.
export function settle(sr, rand, { pitch = 1, air = 0.25 } = {}) {
  const t = new Take(sr, 0.14);
  const hit = t.pulse(0.001, 0.0016 + rand() * 0.0008, 1);
  t.modes(hit, body(260 * pitch * jitter(rand, 0.06), PLATE.slice(0, 5), { tau: 0.016, fall: 1, gain: 1, rand }));
  t.add(t.noise(0.001, 0.035, air, rand, { lp: 0.25, hp: 0.04, curve: 6 }));
  return t.finish(0.85, 0.01);
}

// Paper: fibres snapping (crackle) inside a soft broadband rustle, shaped
// into a gesture. `length` in seconds; `grain` is crackle density.
export function paper(sr, rand, { length = 0.22, grain = 900, bright = 1 } = {}) {
  const t = new Take(sr, length + 0.04);
  const shape = (u) => Math.sin(Math.PI * Math.min(1, u * 1.05)) ** 1.5;
  const snaps = t.crackle(0.002, length, grain, 1, rand, shape);
  t.modes(snaps, [
    [2200 * bright * jitter(rand, 0.1), 0.0012, 0.6],
    [3800 * bright * jitter(rand, 0.1), 0.0009, 0.5],
    [5900 * bright * jitter(rand, 0.1), 0.0006, 0.35],
  ]);
  const hush = t.noise(0.002, length, 0.08, rand, { lp: 0.6, hp: 0.08, curve: 0.6, attack: length * 0.3 });
  t.add(hush);
  return t.finish(0.85, 0.02);
}

// Air moving past: noise through a band-pass that rises and falls with the
// gesture. `up` makes it rise in pitch through its length.
export function whoosh(sr, rand, { length = 0.3, from = 500, to = 2400, q = 1.4, up = true } = {}) {
  const t = new Take(sr, length);
  const src = t.noise(0, length, 1, rand, { lp: 0.9, hp: 0.0, curve: 0 });
  const env = (u) => Math.sin(Math.PI * Math.min(1, u)) ** 2;
  for (let i = 0; i < t.n; i += 1) src[i] *= env(i / t.n);
  const a = up ? from : to;
  const b = up ? to : from;
  t.sweep(src, (u) => a * Math.pow(b / a, Math.sin((u * Math.PI) / 2)), q);
  return t.finish(0.8, 0.02);
}

// A small struck bell or a glass rim — a confirmation, a sent message. The
// mallet is soft, so the upper partials are tamed; near pairs beat.
export function chime(sr, rand, { pitch = 880, length = 0.9, mallet = 0.0009 } = {}) {
  const t = new Take(sr, length);
  const hit = t.pulse(0.001, mallet * jitter(rand, 0.15));
  t.modes(
    hit,
    BELL.map(([ratio, tau, g]) => [pitch * ratio * jitter(rand, 0.002), tau * length * 0.6, g]),
  );
  return t.finish(0.8, 0.05);
}

// An electronic beep through a small speaker or a piezo: an odd-harmonic
// tone with a soft rise and fall, coloured by the speaker's own resonance.
export function beep(sr, rand, { pitch = 2640, length = 0.075, buzz = 0.5 } = {}) {
  const t = new Take(sr, length + 0.03);
  const rise = Math.round(0.003 * sr);
  const fall = Math.round(0.012 * sr);
  const hold = Math.round(length * sr);
  const x = new Float32Array(t.n);
  let phase = rand() * Math.PI * 2;
  const w = (2 * Math.PI * pitch) / sr;
  for (let i = 0; i < hold + fall && i < t.n; i += 1) {
    const env = i < rise ? 0.5 - 0.5 * Math.cos((Math.PI * i) / rise) : i > hold ? 0.5 + 0.5 * Math.cos((Math.PI * (i - hold)) / fall) : 1;
    phase += w;
    let v = Math.sin(phase);
    for (let h = 3; h <= 9 && pitch * h < sr * 0.45; h += 2) v += (buzz * Math.sin(phase * h)) / (h * h * 0.6);
    x[i] = v * env;
  }
  t.add(x, 0.6);
  // The speaker cone: a broad resonance that colours every beep the same way.
  t.modes(x, [[3100, 0.0016, 0.08], [5200, 0.001, 0.04]]);
  return t.finish(0.8, 0.004);
}

// A tiny bubble or a lid popping: a sine whose pitch rises as it closes,
// which is what the ear hears as wet. `pitch` is its resting frequency.
export function pop(sr, rand, { pitch = 900, length = 0.05, rise = 1.6 } = {}) {
  const t = new Take(sr, length + 0.01);
  const n = Math.round(length * sr);
  let phase = 0;
  const f0 = pitch * jitter(rand, 0.05);
  for (let i = 0; i < n; i += 1) {
    const u = i / n;
    phase += (2 * Math.PI * f0 * (1 + (rise - 1) * u)) / sr;
    const env = Math.min(1, i / (0.0012 * sr)) * Math.exp(-u * 6);
    t.out[i] += Math.sin(phase) * env;
  }
  const hit = t.pulse(0, 0.0004, 0.2);
  t.add(hit);
  return t.finish(0.8, 0.006);
}

// A camera's focal-plane shutter: the first curtain releases with a hard
// click, the exposure passes, the second curtain slams; a spring rings and
// the mirror (if any) thumps the body.
export function shutter(sr, rand, { exposure = 0.03, mirror = 0.6 } = {}) {
  const t = new Take(sr, 0.18 + exposure);
  const first = t.pulse(0.002, 0.00025, 0.8);
  const second = t.pulse(0.002 + exposure, 0.0002, 1);
  const both = new Float32Array(t.n);
  for (let i = 0; i < t.n; i += 1) both[i] = first[i] + second[i];
  t.modes(both, body(2300 * jitter(rand, 0.05), BAR, { tau: 0.012, fall: 0.5, rand }));
  t.modes(both, body(5100 * jitter(rand, 0.05), BAR.slice(0, 3), { tau: 0.006, gain: 0.5, rand }));
  if (mirror) {
    const slap = t.pulse(0.004, 0.0014, mirror);
    t.modes(slap, body(420 * jitter(rand, 0.05), PLATE.slice(0, 6), { tau: 0.014, fall: 0.9, gain: 0.5, rand }));
  }
  t.add(t.noise(0.002, 0.012 + exposure, 0.12, rand, { lp: 0.7, hp: 0.15, curve: 3 }));
  return t.finish(0.9, 0.01);
}

// A loopable texture: friction, a motor's whine, tape hiss. Feed it to
// sound.loop() and ramp gain and rate with the motion.
export function texture(sr, rand, { kind = "friction", seconds = 1.2 } = {}) {
  const t = new Take(sr, seconds);
  if (kind === "friction") {
    // Surface asperities catching: dense, tiny, damped contacts.
    const grit = t.crackle(0, seconds, 2600, 1, rand);
    t.modes(grit, [
      [1700 * jitter(rand, 0.05), 0.0008, 0.5],
      [3300 * jitter(rand, 0.05), 0.0006, 0.4],
      [5200 * jitter(rand, 0.05), 0.0004, 0.25],
    ]);
    t.add(t.noise(0, seconds, 0.05, rand, { lp: 0.5, hp: 0.06, curve: 0 }));
  } else if (kind === "motor") {
    // A small DC motor: a commutator buzz at the shaft rate and its gears.
    const f = span(rand, 190, 210);
    for (let i = 0; i < t.n; i += 1) {
      const p = (2 * Math.PI * f * i) / sr;
      t.out[i] = 0.5 * Math.sin(p) + 0.25 * Math.sin(2 * p + 0.3) + 0.12 * Math.sin(3 * p + 1.1) + 0.06 * Math.sin(7 * p);
    }
    const whine = t.noise(0, seconds, 0.4, rand, { lp: 0.8, hp: 0.2, curve: 0 });
    t.sweep(whine, () => 2600, 6, t.out, 0.5);
  } else {
    // Tape or air hiss: soft-edged broadband noise.
    t.add(t.noise(0, seconds, 1, rand, { lp: 0.7, hp: 0.12, curve: 0 }));
  }
  return t.finish(0.7, 0);
}
