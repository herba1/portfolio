import { label } from "../../../lib/sound/label.js";
// The line screen as a tone. A grating of thin dark lines is close to a
// square wave in space, so its spectrum is the odd harmonics; the tone is
// those harmonics, pure, as sines, because a moiré is pure interference and
// anything added on top would blur the beat. Two copies play at once, one
// per screen: the client detunes the top one by the rate the fringes pass,
// and because a rate change moves every harmonic in proportion, harmonic n
// beats n times faster, as the n-th harmonic of the fringe would.
//
// The loop holds a whole number of cycles of every partial, so it repeats
// with no seam at all: 2 s at 48 kHz, 349 cycles of the fundamental.
export const LOOP_SECONDS = 2;
export const BASE = 349 / LOOP_SECONDS;

// The low pair carries the body; the high pair is what clarity opens. The
// fundamental (174.5 Hz) is soft on a laptop speaker, so the third harmonic
// is weighted close to it and the fifth and seventh carry the shimmer.
const LOW = [
  [1, 0.6],
  [3, 0.5],
];
const HIGH = [
  [5, 0.5],
  [7, 0.22],
  [9, 0.08],
];

function screen(partials) {
  return (sr, rand) => {
    const n = Math.round(sr * LOOP_SECONDS);
    const out = new Float32Array(n);
    const cycles = BASE * LOOP_SECONDS;
    // Every partial starts at phase zero, so the take starts on silence;
    // rand only sets a tiny per-take level difference, never pitch.
    const g = partials.map(([, gain]) => gain * (0.98 + rand() * 0.04));
    for (let i = 0; i < n; i += 1) {
      let v = 0;
      for (let k = 0; k < partials.length; k += 1) v += g[k] * Math.sin((2 * Math.PI * partials[k][0] * cycles * i) / n);
      out[i] = v;
    }
    let max = 0;
    for (let i = 0; i < n; i += 1) max = Math.max(max, Math.abs(out[i]));
    for (let i = 0; i < n; i += 1) out[i] *= 0.7 / max;
    return out;
  };
}

export const takes = {
  low: { count: 1, seed: 31, loop: true, render: screen(LOW) },
  high: { count: 1, seed: 32, loop: true, render: screen(HIGH) },
};

label("lab/moire/moireTakes", takes);
