const PC = { C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 };
const QUAL = {
  "": [0, 4, 7],
  m: [0, 3, 7],
  7: [0, 4, 7, 10],
  maj7: [0, 4, 7, 11],
  m7: [0, 3, 7, 10],
  6: [0, 4, 7, 9],
  m6: [0, 3, 7, 9],
  sus4: [0, 5, 7],
  sus2: [0, 2, 7],
  "7sus4": [0, 5, 7, 10],
  dim: [0, 3, 6],
  aug: [0, 4, 8],
  9: [0, 4, 7, 10, 2],
  add9: [0, 4, 7, 2],
  mmaj7: [0, 3, 7, 11],
};
const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  mixo: [0, 2, 4, 5, 7, 9, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
};

const CELLS = {
  rock: [
    [4, 2, 2, 4, 4],
    [2, 2, 2, 2, 4, 4],
    [2, 2, 4, 2, 2, 4],
    [3, 3, 2, 4, 4],
    [-2, 2, 2, 2, 4, 4],
    [4, 2, 2, 2, 2, 4],
    [2, 4, 2, 4, 4],
  ],
  mid: [
    [4, 2, 2, 4, 4],
    [6, 2, 4, 4],
    [4, 4, 8],
    [2, 2, 4, 4, 4],
    [-4, 4, 4, 4],
    [4, 2, 2, 8],
    [3, 3, 2, 8],
  ],
  slow: [
    [8, 4, 4],
    [4, 4, 8],
    [6, 2, 8],
    [4, 2, 2, 8],
    [-4, 4, 8],
    [12, 4],
  ],
  waltz: [
    [4, 4, 4],
    [6, 2, 4],
    [8, 4],
    [4, 2, 2, 4],
    [-4, 4, 4],
    [2, 2, 4, 4],
  ],
};
const CADENCE = { 4: [[4, 4, 8], [8, 8], [4, 12], [2, 2, 12]], 3: [[12], [4, 8], [8, 4]] };

const DRUMS = {
  rock: ["k.......k.k.....", "....s.......s...", "h.h.h.h.h.h.h.h."],
  drive: ["k.....k.k.......", "....s.......s...", "h.h.h.h.h.h.h.h.", "..c...c...c...c."],
  groove: ["k......k..k.....", "....s.......s...", "h.h.h.h.h.h.h.hh"],
  ballad: ["k.......k.k.....", "....s.......s...", "h...h...h...h..."],
  folk: ["k.......k.......", "....t.......t...", "..h...h...h...h."],
  waltz: ["k...........", "....t...t...", "..h...h...h."],
  march: ["k.......k.......", "s..ss.s.s..ss.s.", "h...h...h...h..."],
  shuffle: ["k.......k.......", "....s.......s...", "h.h.h.h.h.h.h.h."],
};

const STYLES = {
  rock: { cells: "rock", bass: "root8", harm: "stab", alt: "echo", drums: "rock", env: "pluck", gate: 0.86 },
  drive: { cells: "rock", bass: "root8", harm: "stab", alt: "thirds", drums: "drive", env: "pluck", gate: 0.8 },
  groove: { cells: "mid", bass: "riff", harm: "pad", alt: "echo", drums: "groove", env: "sustain", gate: 0.92 },
  ballad: { cells: "slow", bass: "long", harm: "arp8", alt: "arp16", drums: "ballad", env: "sustain", gate: 0.94 },
  folk: { cells: "mid", bass: "rootfifth", harm: "arp8", alt: "thirds", drums: "folk", env: "pluck", gate: 0.88 },
  waltz: { cells: "waltz", bass: "waltz", harm: "arp8", alt: "echo", drums: "waltz", env: "pluck", gate: 0.9 },
  strings: { cells: "mid", bass: "quarters", harm: "strings", alt: "strings", drums: null, env: "pluck", gate: 0.7 },
  march: { cells: "mid", bass: "rootfifth", harm: "thirds", alt: "echo", drums: "march", env: "pluck", gate: 0.82 },
  shuffle: { cells: "mid", bass: "walk", harm: "stab", alt: "thirds", drums: "shuffle", env: "pluck", gate: 0.86 },
};

const SPECS = {
  "come together": { bpm: 84, key: "D", mode: "dorian", swing: 0.12, style: "groove", prog: "D7 | D7 | D7 | D7 | Bm | A | G | A", lead: 0.5, lead2: 0.25 },
  something: { bpm: 66, key: "C", mode: "major", style: "ballad", prog: "C | Cmaj7 | C7 | F | D | G | Am | Am D7 G", lead: 0.5, lead2: 0.25 },
  taxman: { bpm: 128, key: "D", mode: "mixo", style: "drive", prog: "D7 | D7 | D7 | D7 | F G | D7 | F G | D7", lead: 0.25, lead2: 0.5 },
  "eleanor rigby": { bpm: 136, key: "E", mode: "dorian", style: "strings", prog: "C | Em | C | Em | Em | Em | C | Em | Em | Em7 | Em6 | Cmaj7 | Em | Em | C | Em", lead: 0.5, lead2: 0.25 },
  "drive my car": { bpm: 120, key: "D", mode: "mixo", style: "drive", prog: "D7 | G7 | D7 | G7 | D7 | G7 | A7 | A7 | Bm | G | Bm | G | Bm | E7 | A | A", lead: 0.5, lead2: 0.25 },
  "norwegian wood": { bpm: 176, meter: 3, key: "E", mode: "mixo", style: "waltz", prog: "E | E | E | E | D | D | E | E | E | E | E | E | D | A | E | E", lead: 0.125, lead2: 0.25 },
  "sgt peppers lonely hearts club band": { bpm: 104, key: "G", mode: "mixo", style: "march", prog: "G | A7 | C | G | G | A7 | C | G", lead: 0.5, lead2: 0.25 },
  "with a little help from my friends": { bpm: 112, key: "E", mode: "major", style: "folk", prog: "E | B | F#m | E | E | B | F#m | E | D | A | E | E | D | A | E | E", lead: 0.5, lead2: 0.25 },
  "two of us": { bpm: 108, key: "G", mode: "major", style: "folk", prog: "G | G | Gsus4 | G | C | Am | G | D", lead: 0.25, lead2: 0.5 },
  "across the universe": { bpm: 76, key: "D", mode: "major", style: "ballad", prog: "D | Bm | F#m | Em7 A | D | Bm | Em7 | A7sus4 A7 | D | D | A7 | A7 | G | G | D | D", lead: 0.5, lead2: 0.125 },
  "magical mystery tour": { bpm: 134, key: "E", mode: "mixo", style: "march", prog: "E | E | D | D | A | A | E | E", lead: 0.5, lead2: 0.25 },
  "the fool on the hill": { bpm: 108, key: "D", mode: "major", style: "ballad", prog: "D6 | Em7 | D6 | Em7 | D6 | Em7 | A7 | D6 | Dm | C | Dm | C | Dm | C | A7 | D6", lead: 0.5, lead2: 0.125 },
  help: { bpm: 152, key: "A", mode: "major", style: "rock", prog: "A | A | C#m | C#m | F#m | F#m | D G | A", lead: 0.5, lead2: 0.25 },
  "the night before": { bpm: 140, key: "D", mode: "mixo", style: "rock", prog: "D C | G A | D C | G A | Bm | G | Bm | Em A", lead: 0.25, lead2: 0.5 },
  "a hard days night": { bpm: 140, key: "G", mode: "mixo", style: "drive", prog: "G C | G | F | G | G C | G | F | G | C | D | G | G | Bm | Em | Bm | G", lead: 0.5, lead2: 0.25, intro: "hdn" },
  "i should have known better": { bpm: 142, key: "G", mode: "major", style: "rock", prog: "G D | G D | G D | G | G D | G D | G D | G | Em | C | Em | C | G | D | G | G", lead: 0.25, lead2: 0.5 },
  "here comes the sun": { bpm: 128, key: "A", mode: "major", style: "folk", prog: "A | D | E | A | A | D | E | A", lead: 0.25, lead2: 0.5 },
  "let it be": { bpm: 72, key: "C", mode: "major", style: "ballad", prog: "C | G | Am | F | C | G | F C | C", lead: 0.5, lead2: 0.25 },
  yesterday: { bpm: 96, key: "F", mode: "major", style: "ballad", prog: "F | Em A7 | Dm | Bb C | F | Dm G | Bb | F", lead: 0.5, lead2: 0.125 },
  "get back": { bpm: 122, key: "A", mode: "mixo", style: "shuffle", swing: 0.12, prog: "A | A | A | A | D | D | A | A", lead: 0.25, lead2: 0.5 },
  "in my life": { bpm: 102, key: "A", mode: "major", style: "folk", prog: "A | E | F#m | A7 | D | Dm | A | A", lead: 0.5, lead2: 0.125 },
};

const MOODS = [
  { bpm: 132, mode: "major", style: "rock", prog: "I | V | vi | IV | I | V | IV | I" },
  { bpm: 118, mode: "minor", style: "drive", prog: "i | VI | III | VII | i | VI | VII | i" },
  { bpm: 76, mode: "major", style: "ballad", prog: "I | vi | IV | V | I | vi | IV V | I" },
  { bpm: 104, mode: "minor", style: "groove", prog: "i | i | iv | i | VI | VII | i | i" },
  { bpm: 168, mode: "major", meter: 3, style: "waltz", prog: "I | I | IV | I | vi | IV | V | I" },
  { bpm: 110, mode: "major", style: "folk", prog: "I | IV | I | V | vi | IV | V | I" },
  { bpm: 84, mode: "minor", style: "ballad", prog: "i | VII | VI | VII | i | iv | V | i" },
  { bpm: 140, mode: "mixo", style: "shuffle", swing: 0.12, prog: "I | I | IV | I | V | IV | I | I" },
];
const NAMES = ["C", "Db", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"];
const ROMAN = { i: 0, ii: 1, iii: 2, iv: 3, v: 4, vi: 5, vii: 6 };

export const normTitle = (s) =>
  String(s || "")
    .toLowerCase()
    .replace(/\s*[([].*?[)\]]\s*/g, " ")
    .replace(/\s+-\s+.*$/, "")
    .replace(/[’'.!,?]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const hash = (s) => {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  return h;
};

const rng = (seed) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

function romanToChords(prog, key, mode) {
  const scale = SCALES[mode];
  const tonic = PC[key];
  return prog
    .split("|")
    .map((bar) =>
      bar
        .trim()
        .split(/\s+/)
        .map((r) => {
          const lower = r === r.toLowerCase();
          const deg = ROMAN[r.toLowerCase()];
          const pc = (tonic + scale[deg]) % 12;
          return `${NAMES[pc]}${lower ? "m" : ""}`;
        })
        .join(" "),
    )
    .join(" | ");
}

export function specFor(title, artist = "") {
  const key = normTitle(title);
  const known = SPECS[key];
  if (known) return { ...known, seed: hash(key), known: true };
  const h = hash(`${key}|${normTitle(artist)}`);
  const mood = MOODS[h % MOODS.length];
  const tonic = NAMES[(h >>> 4) % 12];
  return {
    ...mood,
    key: tonic,
    bpm: mood.bpm + ((h >>> 9) % 9) - 4,
    prog: romanToChords(mood.prog, tonic, mood.mode),
    lead: [0.5, 0.25, 0.125][(h >>> 12) % 3],
    lead2: [0.25, 0.5, 0.25][(h >>> 12) % 3],
    seed: h,
    known: false,
  };
}

function parseChord(sym) {
  const m = /^([A-G][#b]?)([^/]*)(?:\/([A-G][#b]?))?$/.exec(sym.trim());
  if (!m) return { root: 0, pcs: [0, 4, 7] };
  const root = PC[m[1]];
  const q = QUAL[m[2]] ?? QUAL[""];
  return { root, pcs: q.map((i) => (root + i) % 12), third: (root + q[1]) % 12, fifth: (root + (q[2] ?? 7)) % 12, bass: m[3] ? PC[m[3]] : root };
}

export function arrange(title, artist = "") {
  const spec = specFor(title, artist);
  const style = STYLES[spec.style] ?? STYLES.rock;
  const meter = spec.meter ?? 4;
  const steps = meter * 4;
  const rand = rng(spec.seed);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const scale = SCALES[spec.mode].map((i) => (i + PC[spec.key]) % 12);
  const bars = spec.prog.split("|").map((bar) => {
    const syms = bar.trim().split(/\s+/);
    const len = meter / syms.length;
    return syms.map((s, i) => ({ ...parseChord(s), at: i * len, len }));
  });
  const nBars = bars.length;
  const chordAt = (bar, beat) => {
    const segs = bars[((bar % nBars) + nBars) % nBars];
    let c = segs[0];
    for (const s of segs) if (beat >= s.at - 1e-6) c = s;
    return c;
  };

  const tonicMidi = 65 + ((PC[spec.key] - 5 + 12) % 12);
  const lo = tonicMidi - 5;
  const hi = lo + 17;
  const pool = [];
  for (let m = lo; m <= hi; m += 1) if (scale.includes(m % 12)) pool.push(m);
  const nearestIdx = (midi) => {
    let best = 0;
    for (let i = 1; i < pool.length; i += 1) if (Math.abs(pool[i] - midi) < Math.abs(pool[best] - midi)) best = i;
    return best;
  };
  const nearestChordTone = (midi, pcs, dir) => {
    let best = null;
    for (let m = lo; m <= hi; m += 1) {
      if (!pcs.includes(m % 12)) continue;
      const d = Math.abs(m - midi) + (dir && Math.sign(m - midi) === -Math.sign(dir) ? 0.5 : 0);
      if (best == null || d < best.d) best = { m, d };
    }
    return best ? best.m : midi;
  };

  const cells = CELLS[style.cells];
  const cadences = CADENCE[meter] ?? CADENCE[4];
  const meterCells = meter === 3 ? CELLS.waltz : cells;
  const makeMotif = (start) => {
    const r1 = pick(meterCells);
    const r2 = pick(meterCells);
    const contour = Array.from({ length: 16 }, () => pick([-2, -1, -1, -1, 0, 1, 1, 1, 2, 2, 3, -3]));
    return { rhythm: [r1, r2], contour, start };
  };
  const motifs = {
    X: makeMotif(0.45),
    Y: makeMotif(0.7),
    W: makeMotif(0.85),
    V: makeMotif(0.6),
  };
  motifs.Z = { rhythm: [motifs.Y.rhythm[0], pick(cadences)], contour: motifs.Y.contour.map((c) => -Math.abs(c) || -1), start: 0.6, cadence: true };
  motifs.U = { rhythm: [motifs.W.rhythm[1], pick(cadences)], contour: motifs.X.contour, start: 0.75, cadence: true };
  const units = Math.ceil(nBars / 2);
  const plan = units <= 2 ? ["X", "Z"] : units <= 4 ? ["X", "Y", "X", "Z"] : ["X", "Y", "X", "Z", "W", "V", "W", "U"];

  const leadNotes = [];
  let prevMidi = pool[Math.round(pool.length * 0.45)];
  for (let u = 0; u < units; u += 1) {
    const label = plan[u % plan.length];
    const motif = motifs[label];
    let ci = 0;
    let first = true;
    for (let half = 0; half < 2; half += 1) {
      const bar = u * 2 + half;
      if (bar >= nBars) break;
      let pos = 0;
      const rhythm = motif.rhythm[half];
      rhythm.forEach((len, ni) => {
        const dur = Math.abs(len);
        if (len < 0) {
          pos += dur;
          return;
        }
        const beat = pos / 4;
        const chord = chordAt(bar, beat);
        let midi;
        if (first) {
          midi = nearestChordTone(pool[Math.round((pool.length - 1) * motif.start)], chord.pcs, 0);
          first = false;
        } else {
          const step = motif.contour[ci % motif.contour.length];
          ci += 1;
          let idx = nearestIdx(prevMidi) + step;
          if (idx < 0) idx = -idx;
          if (idx > pool.length - 1) idx = 2 * (pool.length - 1) - idx;
          midi = pool[Math.max(0, Math.min(pool.length - 1, idx))];
          const strong = pos % (meter === 3 ? 12 : 8) === 0 || dur >= (meter === 3 ? 6 : 4);
          if (strong) midi = nearestChordTone(midi, chord.pcs, step);
          else if (dur >= 2 && chord.pcs.some((p) => (p - (midi % 12) + 12) % 12 === 1 || ((midi % 12) - p + 12) % 12 === 1) && !chord.pcs.includes(midi % 12)) midi = nearestChordTone(midi, chord.pcs, step);
        }
        const last = half === 1 && ni === rhythm.length - 1;
        if (last && motif.cadence) {
          const tonicPcs = [chord.root, chord.third];
          midi = nearestChordTone(midi, tonicPcs, -1);
        }
        leadNotes.push({ bar, beat, d: dur / 4, m: midi });
        prevMidi = midi;
        pos += dur;
      });
    }
  }

  const loop = [];
  const segList = [];
  const push = (ev) => loop.push(ev);
  const harmFor = ({ seg, s0 }, alt) => {
    const out = [];
    const voices = [];
    for (let m = 57; m <= 77; m += 1) if (seg.pcs.includes(m % 12)) voices.push(m);
    const v3 = voices.find((m) => m % 12 === seg.third && m >= 60) ?? voices[1];
    const v5 = voices.find((m) => m % 12 === seg.fifth && m > v3) ?? voices[2];
    const kind = alt ? style.alt : style.harm;
    if (kind === "arp8" || kind === "arp16") {
      const per = kind === "arp8" ? 2 : 4;
      const tones = voices.filter((m) => m >= 60).slice(0, 4);
      const order = [0, 1, 2, 3, 2, 1];
      for (let i = 0; i < seg.len * per; i += 1) out.push({ ch: 1, t: s0 + i / per, d: 0.9 / per, m: tones[order[i % order.length] % tones.length], v: 0.42, duty: 0.125 });
    } else if (kind === "stab") {
      for (let i = 0; i < seg.len; i += 1) out.push({ ch: 1, t: s0 + i + 0.5, d: 0.2, m: i % 2 ? v5 : v3, v: 0.5, duty: 0.25 });
    } else if (kind === "pad") {
      for (let i = 0; i < seg.len; i += 2) out.push({ ch: 1, t: s0 + i, d: Math.min(2, seg.len - i) - 0.1, m: v3, v: 0.36, duty: 0.5, vib: true });
    } else if (kind === "strings") {
      for (let i = 0; i < seg.len; i += 1) out.push({ ch: 1, t: s0 + i, d: 0.34, m: i % 2 ? v5 : v3, v: 0.5, duty: 0.5 });
    }
    return out;
  };
  const bassMidi = (pc) => {
    const m = 36 + pc;
    return m > 43 ? m - 12 : m;
  };

  for (let bar = 0; bar < nBars; bar += 1) {
    const b0 = bar * meter;
    for (const seg of bars[bar]) {
      const r = bassMidi(seg.bass);
      const f = bassMidi(seg.fifth);
      const t = bassMidi(seg.third);
      const s0 = b0 + seg.at;
      const kind = style.bass;
      if (kind === "root8") {
        for (let i = 0; i < seg.len * 2; i += 1) {
          const atEnd = seg.at + i / 2 >= meter - 0.5;
          push({ ch: 2, t: s0 + i / 2, d: 0.42, m: atEnd ? r + 12 : i === 3 && seg.len >= 4 ? f : r, v: 0.9 });
        }
      } else if (kind === "rootfifth" || kind === "waltz") {
        for (let i = 0; i < seg.len; i += 1) {
          if (kind === "waltz" && i % 3 !== 0) continue;
          const m = i % 2 === 0 ? r : f > r ? f - 12 : f;
          push({ ch: 2, t: s0 + i, d: kind === "waltz" ? 1.6 : 0.82, m, v: 0.9 });
        }
      } else if (kind === "walk") {
        const nextBar = chordAt(bar + 1, 0);
        for (let i = 0; i < seg.len; i += 1) {
          let m = [r, t < r ? t + 12 : t, f < r ? f + 12 : f, bassMidi(nextBar.bass) - 1][i % 4];
          if (i === seg.len - 1 && seg.len >= 4) m = bassMidi(nextBar.bass) + (rand() < 0.5 ? -1 : 2);
          push({ ch: 2, t: s0 + i, d: 0.9, m, v: 0.9 });
        }
      } else if (kind === "long") {
        for (let i = 0; i < seg.len; i += 2) push({ ch: 2, t: s0 + i, d: Math.min(2, seg.len - i) - 0.08, m: i % 4 === 0 ? r : f > r ? f - 12 : f, v: 0.95 });
      } else if (kind === "quarters") {
        for (let i = 0; i < seg.len; i += 1) push({ ch: 2, t: s0 + i, d: 0.5, m: r, v: 0.9 });
      } else if (kind === "riff") {
        const riff = seg.len >= 4 ? [[0, 0, 0.9, -12], [1.5, 12, 0.4], [2, 10, 0.45], [2.5, 7, 0.45], [3, 0, 0.45], [3.5, 3, 0.4]] : [[0, 0, 0.9], [1, 7, 0.9]];
        for (const [o, iv, d, slide] of riff) if (o < seg.len) push({ ch: 2, t: s0 + o, d, m: r + iv, v: 0.95, slide });
      }

      segList.push({ seg, s0, bar });
    }
  }

  const drumKey = style.drums;
  const lanes = drumKey ? DRUMS[drumKey] : null;
  const drumBar = (bar, fill) => {
    if (!lanes) return [];
    const out = [];
    const b0 = bar * meter;
    for (const lane of lanes) {
      for (let i = 0; i < steps; i += 1) {
        const ch = lane[i];
        if (ch === "." || !ch) continue;
        if (fill && i >= steps - (meter === 3 ? 4 : 8) && ch !== "h") continue;
        out.push({ ch: 3, t: b0 + i / 4, kind: ch, v: ch === "h" ? (i % 4 === 0 ? 0.7 : 0.5) : 1 });
      }
    }
    if (fill) {
      const from = steps - (meter === 3 ? 4 : 8);
      for (let i = from; i < steps; i += i >= steps - 4 ? 1 : 2) out.push({ ch: 3, t: b0 + i / 4, kind: drumKey === "ballad" || drumKey === "folk" || drumKey === "waltz" ? "m" : "s", v: 0.55 + (0.45 * (i - from)) / (steps - from) });
    }
    return out;
  };

  const beatSec = 60 / spec.bpm;
  const swing = spec.swing ?? 0;
  const warp = (beat) => {
    if (!swing) return beat;
    const whole = Math.floor(beat);
    const f = beat - whole;
    const mid = 0.5 + swing;
    return whole + (f <= 0.5 ? (f / 0.5) * mid : mid + ((f - 0.5) / 0.5) * (1 - mid));
  };
  const loopBeats = nBars * meter;
  const loopSec = loopBeats * beatSec;
  const reps = Math.max(1, Math.min(4, Math.round(66 / loopSec)));
  const introBars = spec.bpm < 90 ? 1 : 2;
  const introBeats = introBars * meter + (spec.intro === "hdn" ? meter : 0);
  const events = [];
  const add = (beat, d, ev) => {
    const a = warp(beat);
    const b = warp(beat + d);
    events.push({ ...ev, s: a * beatSec, d: Math.max(0.03, (b - a) * beatSec) });
  };

  let cursor = 0;
  if (spec.intro === "hdn") {
    add(0, meter * 0.96, { ch: 2, m: 38, v: 1 });
    [65, 69, 72, 67, 74].forEach((m, i) => add(i * 0.04, meter * 0.94 - i * 0.04, { ch: 1, m, v: 0.42, duty: 0.25, vib: true }));
    add(0.02, meter * 0.95, { ch: 0, m: 79, v: 0.55, duty: 0.5, vib: true });
    add(0, 0.1, { ch: 3, kind: "x", v: 1 });
    cursor = meter;
  }
  for (let b = 0; b < introBars; b += 1) {
    const ob = cursor + b * meter;
    for (const ev of loop) if (ev.t >= b * meter && ev.t < (b + 1) * meter) add(ob + ev.t - b * meter, ev.d, ev);
    for (const sg of segList) if (sg.bar === b) for (const h of harmFor(sg, false)) add(ob + h.t - b * meter, h.d, h);
    for (const d of drumBar(b, b === introBars - 1)) add(ob + d.t - b * meter, 0.1, d);
  }
  cursor += introBars * meter;

  const harmEvents = (alt) => segList.flatMap((sg) => harmFor(sg, alt));
  const harmA = harmEvents(false);
  const harmB = harmEvents(true);
  const scaleBelow = (m) => {
    const i = nearestIdx(m);
    return pool[Math.max(0, i - 2)] - (i - 2 < 0 ? 3 : 0);
  };

  const loopStart = cursor * beatSec;
  for (let rep = 0; rep < reps; rep += 1) {
    const ob = cursor + rep * loopBeats;
    const alt = rep % 2 === 1;
    for (const ev of loop) add(ob + ev.t, ev.d, ev);
    const harmKind = alt ? style.alt : style.harm;
    if (harmKind === "echo" || harmKind === "thirds") {
      for (const n of leadNotes) {
        const t = n.bar * meter + n.beat;
        if (harmKind === "echo") add(ob + t + 0.5, Math.max(0.12, n.d * style.gate * 0.8), { ch: 1, m: n.m, v: 0.26, duty: alt ? spec.lead : spec.lead2 });
        else add(ob + t, n.d * style.gate, { ch: 1, m: scaleBelow(n.m), v: 0.38, duty: 0.25 });
      }
    } else for (const h of alt ? harmB : harmA) add(ob + h.t, h.d, h);
    for (const n of leadNotes) {
      const t = n.bar * meter + n.beat;
      const d = style.env === "sustain" ? n.d * style.gate : Math.min(n.d * style.gate, n.d - 0.06);
      add(ob + t, d, { ch: 0, m: n.m, v: 0.62, duty: alt ? spec.lead2 : spec.lead, vib: n.d >= 0.75, env: style.env });
    }
    for (let bar = 0; bar < nBars; bar += 1) {
      const fill = bar === nBars - 1;
      for (const d of drumBar(bar, fill)) add(ob + d.t, 0.1, d);
    }
    if (lanes) add(ob, 0.1, { ch: 3, kind: "x", v: rep === 0 ? 1 : 0.8 });
  }
  cursor += reps * loopBeats;
  const endChord = chordAt(0, 0);
  add(cursor, meter * 0.95, { ch: 2, m: bassMidi(endChord.bass), v: 1 });
  add(cursor, meter * 0.95, { ch: 1, m: nearestChordTone(64, [endChord.third], 0), v: 0.32, duty: 0.25, vib: true });
  add(cursor, meter * 0.95, { ch: 0, m: nearestChordTone(tonicMidi, [endChord.root], 0), v: 0.5, duty: spec.lead, vib: true, env: "sustain" });
  if (lanes) add(cursor, 0.1, { ch: 3, kind: "x", v: 0.9 });
  cursor += meter;

  events.sort((a, b) => a.s - b.s || a.ch - b.ch);
  return {
    title,
    known: spec.known,
    bpm: spec.bpm,
    events,
    length: cursor * beatSec + 0.6,
    loopStart,
    loopLen: loopSec,
  };
}
