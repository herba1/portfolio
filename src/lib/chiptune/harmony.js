// Key and chords from the transcription's frame activations: fold the 88
// pitches into a chroma vector per beat, score chord templates against it,
// and let a Viterbi pass keep each chord until the evidence says it changed.

import { MIDI_OFFSET, PITCHES, frameTime } from "./model";

export const PC_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
export const QUALITIES = {
  maj: [0, 4, 7],
  min: [0, 3, 7],
  7: [0, 4, 7, 10],
  min7: [0, 3, 7, 10],
};
const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

// Mean chroma (and bass chroma, below E3) over each [edges[i], edges[i+1]).
export function chromaBetween({ frames, nFrames }, edges) {
  const out = [];
  let f = 0;
  for (let i = 0; i < edges.length - 1; i += 1) {
    const c = new Float32Array(12);
    const b = new Float32Array(12);
    while (f < nFrames && frameTime(f) < edges[i]) f += 1;
    let g = f;
    for (; g < nFrames && frameTime(g) < edges[i + 1]; g += 1) {
      for (let p = 0; p < PITCHES; p += 1) {
        const v = frames[g * PITCHES + p];
        if (v < 0.1) continue;
        const midi = p + MIDI_OFFSET;
        c[midi % 12] += v;
        if (midi < 52) b[midi % 12] += v;
      }
    }
    const count = Math.max(1, g - f);
    for (let k = 0; k < 12; k += 1) {
      c[k] /= count;
      b[k] /= count;
    }
    out.push({ chroma: c, bass: b });
  }
  return out;
}

const corr = (x, y) => {
  let mx = 0;
  let my = 0;
  for (let i = 0; i < 12; i += 1) {
    mx += x[i];
    my += y[i];
  }
  mx /= 12;
  my /= 12;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < 12; i += 1) {
    num += (x[i] - mx) * (y[i] - my);
    dx += (x[i] - mx) ** 2;
    dy += (y[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy || 1);
};

// Krumhansl-Schmuckler key finding.
export function estimateKey(chroma) {
  let best = { tonic: 0, mode: "major", score: -Infinity };
  for (let t = 0; t < 12; t += 1) {
    for (const [mode, prof] of [
      ["major", MAJOR],
      ["minor", MINOR],
    ]) {
      const rot = Array.from({ length: 12 }, (_, i) => prof[(i - t + 12) % 12]);
      const score = corr(chroma, rot);
      if (score > best.score) best = { tonic: t, mode, score };
    }
  }
  return best;
}

const STATES = [];
for (let root = 0; root < 12; root += 1) {
  for (const [quality, ivs] of Object.entries(QUALITIES)) {
    const t = new Float32Array(12);
    for (const iv of ivs) t[(root + iv) % 12] = 1;
    // Sevenths only when the seventh is really there: their templates are
    // supersets of the triad, so give them a small handicap.
    STATES.push({ root, quality, template: t, cost: ivs.length > 3 ? 0.06 : 0 });
  }
}

const cosine = (x, t) => {
  let num = 0;
  let nx = 0;
  let nt = 0;
  for (let i = 0; i < 12; i += 1) {
    num += x[i] * t[i];
    nx += x[i] * x[i];
    nt += t[i] * t[i];
  }
  return nx > 0 ? num / Math.sqrt(nx * nt) : 0;
};

// One chord per beat span. `stay` is how much a change costs, in units of
// template fit; a chord has to win clearly for a beat or two to take over.
export function estimateChords(spans, { stay = 0.12, bassWeight = 0.25 } = {}) {
  const S = STATES.length;
  const n = spans.length;
  if (!n) return [];
  const emit = spans.map(({ chroma, bass }) => {
    let bt = 0;
    for (let k = 0; k < 12; k += 1) bt += bass[k];
    return STATES.map((st) => cosine(chroma, st.template) - st.cost + (bt > 0 ? bassWeight * (bass[st.root] / bt) : 0));
  });
  const score = new Float32Array(S);
  const back = [];
  for (let s = 0; s < S; s += 1) score[s] = emit[0][s];
  for (let i = 1; i < n; i += 1) {
    let top = 0;
    for (let s = 1; s < S; s += 1) if (score[s] > score[top]) top = s;
    const next = new Float32Array(S);
    const from = new Int16Array(S);
    for (let s = 0; s < S; s += 1) {
      const keep = score[s];
      const move = score[top] - stay;
      if (keep >= move) {
        next[s] = keep + emit[i][s];
        from[s] = s;
      } else {
        next[s] = move + emit[i][s];
        from[s] = top;
      }
    }
    score.set(next);
    back.push(from);
  }
  let s = 0;
  for (let k = 1; k < S; k += 1) if (score[k] > score[s]) s = k;
  const path = [s];
  for (let i = n - 2; i >= 0; i -= 1) {
    s = back[i][s];
    path.push(s);
  }
  path.reverse();
  return path.map((k, i) => {
    const energy = spans[i].chroma.reduce((a, v) => a + v, 0);
    return energy < 0.05 ? null : { root: STATES[k].root, quality: STATES[k].quality };
  });
}

export const chordName = (c) => (c ? `${PC_NAMES[c.root]}${c.quality === "maj" ? "" : c.quality === "min" ? "m" : c.quality === "min7" ? "m7" : c.quality}` : "N");

export const chordTones = (c) => QUALITIES[c.quality].map((iv) => (c.root + iv) % 12);
