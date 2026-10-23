// Melody and bass as single lines through the transcription. A Viterbi pass
// over one state per semitone (plus silence) walks the frame activations:
// staying on a pitch is free, moving costs more the further it jumps, so the
// line follows one voice instead of hopping between whatever is loudest. The
// tilt leans toward the top of the range for a melody and the bottom for a bass.

import { MIDI_OFFSET, PITCHES, frameTime } from "./model";

export function trackLine({ frames, onsets, nFrames }, { lo, hi, voicing = 0.3, tilt = 0.3, jump = 0.35, slope = 0.025, enter = 0.2, minFrames = 6, split = 0.65, island = 12 }) {
  const K = hi - lo + 1;
  const S = K + 1;
  const n = nFrames;
  if (!n) return [];
  const gain = Array.from({ length: K }, (_, k) => 1 + tilt * (k / (K - 1) - 0.5) * 2);
  const act = (t, k) => frames[t * PITCHES + (lo + k - MIDI_OFFSET)];
  const onset = (t, k) => (t >= 0 && t < n ? onsets[t * PITCHES + (lo + k - MIDI_OFFSET)] : 0);
  let score = new Float32Array(S);
  let next = new Float32Array(S);
  const back = new Uint8Array(n * S);
  const emit = (t, s) => (s === 0 ? voicing : act(t, s - 1) * gain[s - 1]);
  for (let s = 0; s < S; s += 1) score[s] = emit(0, s);
  for (let t = 1; t < n; t += 1) {
    for (let s = 0; s < S; s += 1) {
      let best = score[s];
      let arg = s;
      for (let r = 0; r < S; r += 1) {
        if (r === s) continue;
        const cost = r === 0 || s === 0 ? enter : jump + slope * Math.abs(r - s);
        const v = score[r] - cost;
        if (v > best) {
          best = v;
          arg = r;
        }
      }
      next[s] = best + emit(t, s);
      back[t * S + s] = arg;
    }
    [score, next] = [next, score];
  }
  let s = 0;
  for (let k = 1; k < S; k += 1) if (score[k] > score[s]) s = k;
  const path = new Uint8Array(n);
  for (let t = n - 1; t >= 0; t -= 1) {
    path[t] = s;
    s = back[t * S + s];
  }

  // Runs of one pitch become notes, split where the model hears a re-attack.
  const runs = [];
  const close = (k, f0, f1) => {
    if (f1 - f0 < minFrames) return;
    runs.push({ k, f0, f1 });
  };
  let t0 = 0;
  for (let t = 1; t <= n; t += 1) {
    const cur = path[t0];
    if (t < n && path[t] === cur) {
      if (cur && t - t0 >= minFrames) {
        const o = onset(t, cur - 1);
        if (o > split && o >= onset(t - 1, cur - 1) && o >= onset(t + 1, cur - 1)) {
          close(cur - 1, t0, t);
          t0 = t;
        }
      }
      continue;
    }
    if (cur) close(cur - 1, t0, t);
    t0 = t;
  }

  // The path only commits once a note is clearly there; pull each start back
  // to the model's onset peak for that pitch, if one sits just before it.
  runs.forEach((r, i) => {
    const floor = i > 0 ? runs[i - 1].f1 : 0;
    let best = r.f0;
    let peak = 0.3;
    for (let t = Math.max(floor, r.f0 - 8); t <= Math.min(n - 1, r.f0 + 2); t += 1) {
      const o = onset(t, r.k);
      if (o > peak) {
        peak = o;
        best = t;
      }
    }
    if (best < r.f1 - minFrames) r.f0 = best;
  });

  // A short note that leaps away and straight back is a neighbouring voice
  // poking through a gap in the line, not part of it.
  const keep = runs.filter((r, i) => {
    if (r.f1 - r.f0 > island) return true;
    const a = runs[i - 1];
    const b = runs[i + 1];
    const far = (o) => !o || Math.abs(o.k - r.k) >= 5;
    const near = (o, gap) => o && gap <= island;
    return !(far(a) && far(b) && (near(a, r.f0 - (a?.f1 ?? 0)) || near(b, (b?.f0 ?? 0) - r.f1)));
  });

  return keep.map(({ k, f0, f1 }) => {
    let a = 0;
    for (let t = f0; t < f1; t += 1) a += act(t, k);
    return { start: frameTime(f0), end: frameTime(f1), midi: lo + k, amp: a / (f1 - f0) };
  });
}
