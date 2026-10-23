// An analysis (analyze.js) becomes a song for synth.js: the melody on a
// 25% pulse, the chords as a tracker arpeggio on the second pulse, the bass on
// the triangle and the drums on the noise kit. Every note is snapped to the
// song's own sixteenth grid, which follows the tracked beats, so the remake
// lines up with the original second for second.

import { chordTones } from "./harmony";
import { snap } from "./rhythm";

const LEAD = { lo: 60, hi: 88 };
const BASS = { lo: 28, hi: 52 };
const HARM_FLOOR = 57;

const fold = (m, { lo, hi }) => {
  let x = m;
  while (x < lo) x += 12;
  while (x > hi) x -= 12;
  return x;
};

// Notes to non-overlapping [slot, slot) spans; a later note cuts an earlier one.
function toSlots(notes, grid) {
  const out = [];
  for (const n of notes) {
    const a = snap(grid, n.start);
    const b = Math.max(a + 1, snap(grid, n.end));
    const prev = out[out.length - 1];
    if (prev && a <= prev.a) {
      if (n.amp > prev.amp) out[out.length - 1] = { ...n, a, b };
      continue;
    }
    if (prev && prev.b > a) prev.b = a;
    out.push({ ...n, a, b });
  }
  return out;
}

export function arrange(analysis, { title = "Untitled", artist = "", arpRate = 25, harmonyDuty = 0.25 } = {}) {
  const { grid, beats, melody, bass, chords, drums, duration } = analysis;
  const beatLen = beats.length > 1 ? (beats[beats.length - 1] - beats[0]) / (beats.length - 1) : 0.5;
  const at = (slot) => grid[Math.min(slot, grid.length - 1)];
  const events = [];

  // The lead sits where a square wave sounds best; a melody that runs low
  // moves up an octave as a whole rather than note by note.
  const lead = toSlots(melody, grid);
  const median = lead.length ? lead.map((n) => n.midi).sort((x, y) => x - y)[lead.length >> 1] : 72;
  const shift = median < 64 ? 12 : median > 84 ? -12 : 0;
  const amps = lead.map((n) => n.amp);
  const ampLo = Math.min(...amps);
  const ampHi = Math.max(...amps);
  for (const n of lead) {
    const s = at(n.a);
    const len = at(n.b) - s;
    const long = len >= beatLen * 0.9;
    const v = 0.5 + 0.18 * (ampHi > ampLo ? (n.amp - ampLo) / (ampHi - ampLo) : 0.5);
    events.push({ ch: 0, s, d: long ? len * 0.94 : Math.max(0.05, len - Math.min(0.04, len * 0.2)), m: fold(n.midi + shift, LEAD), v, duty: 0.5, env: long ? "sustain" : "pluck", vib: len >= beatLen * 1.4 });
  }

  // Bass: the transcribed line, with the chord root filling any beat it
  // leaves empty so the low end never drops out under a held chord.
  const low = toSlots(bass, grid);
  let lastBass = 40;
  const covered = new Uint8Array(grid.length);
  for (const n of low) {
    const m = fold(n.midi, BASS);
    lastBass = m;
    const s = at(n.a);
    const len = at(n.b) - s;
    events.push({ ch: 2, s, d: Math.max(0.05, len * 0.92), m, v: 0.9 });
    for (let k = n.a; k < n.b; k += 1) covered[k] = 1;
  }

  for (const c of chords) {
    if (c.root == null) continue;
    const tones = chordTones(c);
    const a = snap(grid, c.start);
    const b = Math.max(a + 1, snap(grid, c.end));
    // Arpeggios sit between A3 and G#4, under the lead and clear of the bass.
    const root = HARM_FLOOR + ((c.root - HARM_FLOOR + 120) % 12);
    const arp = tones.map((pc) => (pc - c.root + 12) % 12).sort((x, y) => x - y);
    // Harmony restrikes on every beat, so it carries the pulse even without drums.
    for (let k = a; k < b; k += 4) {
      const end = Math.min(b, k + 4);
      const s = at(k);
      events.push({ ch: 1, s, d: Math.max(0.05, (at(end) - s) * 0.9), m: root, arp, arpRate, v: 0.8, duty: harmonyDuty, env: "pluck" });
      if (!covered[k]) {
        const near = fold(c.root + 12 * Math.round((lastBass - c.root) / 12), BASS);
        events.push({ ch: 2, s, d: Math.max(0.05, (at(Math.min(end, k + 2)) - s) * 0.9), m: near, v: 0.8 });
      }
    }
  }

  for (const h of drums) events.push({ ch: 3, s: at(h.slot), kind: h.kind, v: h.v });

  events.sort((x, y) => x.s - y.s || x.ch - y.ch);
  const length = Math.max(duration, events.length ? events[events.length - 1].s + 1 : 0) + 0.4;
  return { title, artist, events, length, bpm: analysis.bpm, loopStart: 0, loopLen: length, known: true, converted: true };
}
