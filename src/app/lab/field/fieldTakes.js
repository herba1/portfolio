import { Take, jitter } from "../../../lib/sound/synth.js";
import { seamless } from "../../../lib/sound/engine.js";

// Wind through the field, as loops the client pitches and fades with the
// swell. Wind is air tearing around edges: broadband turbulence whose band
// rises as it blows harder (the body), the hiss of it past a thousand small
// edges (the rush), and the aeolian tone a gust sings across a wire or a
// slot (the whistle). When the characters gather into a picture, the wind
// finds a chord the way it does in an aeolian harp: strings excited by the
// moving air, ringing at their own partials.

// Cut a seamless loop where it crosses zero, so the take starts and ends on
// silence and the seam stays where the crossfade put it.
export function loopable(data, sr, fadeSeconds = 0.08) {
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

// A slow random contour with whole cycles over the take, so the loop has
// gusts inside it that still meet themselves at the seam.
// Tabulated once (a sine per sample per gust is the slow part of a render)
// and read back as a function of the take's progress, 0..1.
function contour(rand, cycles = [2, 3, 5]) {
  const parts = cycles.map((c) => [c, rand() * Math.PI * 2, 0.4 + rand() * 0.6]);
  const total = parts.reduce((s, p) => s + p[2], 0);
  const steps = 2048;
  const table = new Float32Array(steps + 1);
  for (let j = 0; j <= steps; j += 1) {
    let v = 0;
    for (const [c, ph, a] of parts) v += a * Math.sin((2 * Math.PI * c * j) / steps + ph);
    table[j] = v / total;
  }
  return (u) => {
    const x = Math.min(1, Math.max(0, u)) * steps;
    const j = Math.floor(x);
    const f = x - j;
    return j >= steps ? table[steps] : table[j] + (table[j + 1] - table[j]) * f;
  };
}

function windBody(sr, rand) {
  const seconds = 6;
  const t = new Take(sr, seconds);
  const src = t.noise(0, seconds, 1, rand, { lp: 0.3, hp: 0.01, curve: 0 });
  const gust = contour(rand);
  for (let i = 0; i < t.n; i += 1) src[i] *= 0.65 + 0.35 * gust(i / t.n);
  // Two moving bands: the turbulent core and a broader shoulder above it.
  const wander = contour(rand, [1, 3, 4]);
  t.sweep(src, (u) => 380 * (1 + 0.22 * wander(u)), 1.1);
  t.sweep(src, (u) => 720 * (1 + 0.18 * wander(u)), 0.9, t.out, 0.45);
  return loopable(t.finish(0.7, 0), sr);
}

function windRush(sr, rand) {
  const seconds = 5;
  const t = new Take(sr, seconds);
  const src = t.noise(0, seconds, 1, rand, { lp: 0.4, hp: 0.06, curve: 0 });
  const gust = contour(rand, [3, 4, 7]);
  for (let i = 0; i < t.n; i += 1) src[i] *= 0.6 + 0.4 * gust(i / t.n);
  t.sweep(src, (u) => 1700 * (1 + 0.15 * gust(u)), 0.8);
  return loopable(t.finish(0.7, 0), sr);
}

// A narrow resonance on the wind: two slots of slightly different width, so
// two close whistles drift in and out against each other.
function whistle(sr, rand) {
  const seconds = 5;
  const t = new Take(sr, seconds);
  const src = t.noise(0, seconds, 1, rand, { lp: 0.7, hp: 0.02, curve: 0 });
  const a = contour(rand, [2, 3, 5]);
  const b = contour(rand, [1, 4, 6]);
  const sa = new Float32Array(t.n);
  const sb = new Float32Array(t.n);
  for (let i = 0; i < t.n; i += 1) {
    const u = i / t.n;
    sa[i] = src[i] * Math.max(0, 0.3 + a(u));
    sb[i] = src[i] * Math.max(0, 0.2 + b(u));
  }
  t.sweep(sa, (u) => 700 * (1 + 0.05 * b(u)), 9);
  t.sweep(sb, (u) => 905 * (1 + 0.05 * a(u)), 8, t.out, 0.7);
  return loopable(t.finish(0.7, 0), sr);
}

// The four chords the piece walks through as it gathers words.
export const CHORDS = [
  [220, 277.18, 329.63, 440],
  [196, 246.94, 293.66, 392],
  [174.61, 220, 261.63, 349.23],
  [164.81, 207.65, 246.94, 329.63],
];

// Strings in the wind: noise is the bow, each string rings its first few
// partials with a long tau (a narrow band, so it reads as pitch), and each
// string swells on its own as the gust reaches it. The fundamentals sit low
// for a laptop speaker, so the second and third partials carry most of it.
function harp(chord) {
  return (sr, rand) => {
    const seconds = 4.5;
    const t = new Take(sr, seconds);
    const air = t.noise(0, seconds, 1, rand, { lp: 0.5, hp: 0.01, curve: 0 });
    const weights = [1, 0.75, 0.65, 0.45];
    chord.forEach((f, k) => {
      const swell = contour(rand, [1, 2, 3]);
      const x = new Float32Array(t.n);
      for (let i = 0; i < t.n; i += 1) x[i] = air[i] * (0.55 + 0.45 * swell(i / t.n));
      const d = jitter(rand, 0.0015);
      t.modes(
        x,
        [
          [f, 0.35, 0.5],
          [f * 2.002, 0.28, 0.75],
          [f * 3.006, 0.2, 0.5],
          [f * 4.01, 0.14, 0.22],
        ],
        { scale: weights[k], detune: d },
      );
    });
    return loopable(t.finish(0.7, 0), sr, 0.12);
  };
}

export const takes = {
  body: { count: 1, seed: 21, loop: true, render: windBody },
  rush: { count: 1, seed: 22, loop: true, render: windRush },
  whistle: { count: 1, seed: 23, loop: true, render: whistle },
  harp0: { count: 1, seed: 24, loop: true, render: harp(CHORDS[0]) },
  harp1: { count: 1, seed: 25, loop: true, render: harp(CHORDS[1]) },
  harp2: { count: 1, seed: 26, loop: true, render: harp(CHORDS[2]) },
  harp3: { count: 1, seed: 27, loop: true, render: harp(CHORDS[3]) },
};
