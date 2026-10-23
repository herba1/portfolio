// Basic Pitch's note decoder (output_to_notes_polyphonic), on flat typed
// arrays. Same thresholds and the same "melodia trick" second pass, but each
// pass is one sort instead of a full-matrix scan per note.

import { MIDI_OFFSET, PITCHES, frameTime } from "./model";

export function decodeNotes({ frames, onsets, nFrames }, { onsetThresh = 0.5, frameThresh = 0.3, minFrames = 7, tolerance = 11 } = {}) {
  const P = PITCHES;
  const n = nFrames;
  if (n < 3) return [];
  // Onsets the model missed but the frames imply: a pitch switching on.
  const inferred = new Float32Array(n * P);
  let onsetMax = 0;
  let diffMax = 0;
  for (let i = 0; i < n * P; i += 1) onsetMax = Math.max(onsetMax, onsets[i]);
  for (let t = 2; t < n; t += 1) {
    for (let p = 0; p < P; p += 1) {
      const v = frames[t * P + p];
      const d = Math.max(0, Math.min(v - frames[(t - 1) * P + p], v - frames[(t - 2) * P + p]));
      inferred[t * P + p] = d;
      if (d > diffMax) diffMax = d;
    }
  }
  const k = diffMax > 0 ? onsetMax / diffMax : 0;
  for (let i = 0; i < n * P; i += 1) inferred[i] = Math.max(onsets[i], inferred[i] * k);

  const starts = [];
  for (let t = 0; t < n; t += 1) {
    for (let p = 0; p < P; p += 1) {
      const v = inferred[t * P + p];
      if (v <= onsetThresh) continue;
      if (t > 0 && inferred[(t - 1) * P + p] >= v) continue;
      if (t < n - 1 && inferred[(t + 1) * P + p] >= v) continue;
      starts.push(t * P + p);
    }
  }

  const energy = frames.slice();
  const clear = (t, p) => {
    energy[t * P + p] = 0;
    if (p < P - 1) energy[t * P + p + 1] = 0;
    if (p > 0) energy[t * P + p - 1] = 0;
  };
  const mean = (t0, t1, p) => {
    let s = 0;
    for (let t = t0; t < t1; t += 1) s += frames[t * P + p];
    return s / Math.max(1, t1 - t0);
  };
  const notes = [];
  for (let i = starts.length - 1; i >= 0; i -= 1) {
    const t0 = Math.floor(starts[i] / P);
    const p = starts[i] % P;
    if (t0 >= n - 1) continue;
    let t = t0 + 1;
    let quiet = 0;
    while (t < n - 1 && quiet < tolerance) {
      quiet = energy[t * P + p] < frameThresh ? quiet + 1 : 0;
      t += 1;
    }
    t -= quiet;
    if (t - t0 <= minFrames) continue;
    for (let j = t0; j < t; j += 1) clear(j, p);
    notes.push({ f0: t0, f1: t, p, amp: mean(t0, t, p) });
  }

  // Sustained energy with no onset (legato, slow attacks): grow a note out
  // from each remaining peak, strongest first.
  const peaks = [];
  for (let i = 0; i < n * P; i += 1) if (energy[i] > frameThresh) peaks.push(i);
  peaks.sort((a, b) => energy[b] - energy[a]);
  for (const idx of peaks) {
    if (energy[idx] <= frameThresh) continue;
    const mid = Math.floor(idx / P);
    const p = idx % P;
    energy[idx] = 0;
    let t = mid + 1;
    let quiet = 0;
    while (t < n - 1 && quiet < tolerance) {
      quiet = energy[t * P + p] < frameThresh ? quiet + 1 : 0;
      clear(t, p);
      t += 1;
    }
    const end = t - 1 - quiet;
    t = mid - 1;
    quiet = 0;
    while (t > 0 && quiet < tolerance) {
      quiet = energy[t * P + p] < frameThresh ? quiet + 1 : 0;
      clear(t, p);
      t -= 1;
    }
    const start = t + 1 + quiet;
    if (end - start <= minFrames) continue;
    notes.push({ f0: start, f1: end, p, amp: mean(start, end, p) });
  }

  return notes
    .map(({ f0, f1, p, amp }) => ({ start: frameTime(f0), end: frameTime(f1), f0, f1, midi: p + MIDI_OFFSET, amp }))
    .sort((a, b) => a.start - b.start || a.midi - b.midi);
}
