import { chordName, chromaBetween, estimateChords, estimateKey } from "./harmony";
import { trackLine } from "./lines";
import { HOP, RATE, posteriorgrams } from "./model";
import { decodeNotes } from "./notes";
import { beatTimes, detectDrums, estimatePeriod, onsetFeatures, refinePeriod, sixteenths, snap, trackBeats } from "./rhythm";

export const MELODY = { lo: 48, hi: 91, voicing: 0.32, tilt: 0.35 };
export const BASS = { lo: 28, hi: 54, voicing: 0.28, tilt: -0.3 };

// The bar line sits where chords change and the low end hits.
function downbeatPhase(beats, chords, feat) {
  const best = { phase: 0, score: -Infinity };
  for (let phase = 0; phase < 4; phase += 1) {
    let score = 0;
    for (let i = phase; i < chords.length; i += 4) {
      const prev = chords[i - 1];
      const cur = chords[i];
      if (i > 0 && cur && (!prev || prev.root !== cur.root || prev.quality !== cur.quality)) score += 1;
      const f = Math.round(beats[i] * feat.fps);
      if (f >= 0 && f < feat.n) score += 0.5 * Math.min(2, feat.low[f] / (feat.lowRef || 1));
    }
    if (score > best.score) Object.assign(best, { phase, score });
  }
  return best.phase;
}

// mono: Float32Array at 22050Hz. Everything a renderer needs to rebuild the
// song: beat grid, key, chord segments, melody and bass lines, drum hits.
export async function analyze(mono, { model, onProgress, signal, posteriors } = {}) {
  const duration = mono.length / RATE;
  const post = posteriors ?? (await posteriorgrams(mono, { model, signal, onProgress: (p) => onProgress?.(p * 0.9) }));
  const notes = decodeNotes(post);
  const feat = onsetFeatures(mono, RATE, HOP);
  feat.lowRef = feat.low.reduce((a, v) => Math.max(a, v), 0) * 0.5;
  const period = refinePeriod(estimatePeriod(feat.all, feat.fps), feat);
  const beats = beatTimes(trackBeats(feat.all, period), feat.fps, duration, period);
  const bpm = (60 * feat.fps) / period;
  onProgress?.(0.94);

  const melody = trackLine(post, MELODY);
  const bass = trackLine(post, BASS);
  // Chords are read per beat, or per half beat when the tempo is slow: a slow
  // reading may be a fast song counted in halves, and its chords can still
  // change on every real beat.
  const split = bpm < 100 ? 2 : 1;
  const marks = beats.flatMap((b, i) => (i + 1 < beats.length ? Array.from({ length: split }, (_, k) => b + ((beats[i + 1] - b) * k) / split) : [b]));
  const spans = chromaBetween(post, marks);
  const total = new Float32Array(12);
  for (const s of spans) for (let k = 0; k < 12; k += 1) total[k] += s.chroma[k];
  const key = estimateKey(total);
  const perSpan = estimateChords(spans);
  const perBeat = beats.map((_, i) => perSpan[i * split] ?? null);
  const phase = downbeatPhase(beats, perBeat, feat);

  const chords = [];
  perSpan.forEach((c, i) => {
    const last = chords[chords.length - 1];
    if (last && (last.chord === c || (last.chord && c && last.chord.root === c.root && last.chord.quality === c.quality))) last.end = marks[i + 1];
    else chords.push({ start: marks[i], end: marks[i + 1], chord: c });
  });

  const grid = sixteenths(beats);
  const lowOnsets = new Uint8Array(grid.length);
  for (const n of bass) lowOnsets[snap(grid, n.start)] = 1;
  const drums = detectDrums(feat, grid, { lowOnsets, downbeat: phase }).map((h) => ({ ...h, time: grid[h.slot] }));
  onProgress?.(1);

  return {
    backend: post.backend ?? null,
    duration,
    bpm,
    beats,
    downbeat: phase,
    grid,
    key,
    notes,
    melody,
    bass,
    chords: chords.map(({ start, end, chord }) => ({ start, end, name: chordName(chord), root: chord?.root ?? null, quality: chord?.quality ?? null })),
    drums,
  };
}
