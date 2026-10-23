// Standard MIDI Files from the converter: the chip arrangement (songToMidi) or
// the raw transcription (analysisToMidi). The tempo map follows the tracked
// beats, so every note lands on the grid in a DAW and the file lines up with
// the audio it came from.

import { QUALITIES } from "./harmony";

const PPQ = 480;
const DRUM_KEYS = { k: 36, s: 38, h: 42, o: 46, c: 39, t: 37, m: 45, x: 49 };
const TRACKS = [
  { name: "Lead (pulse 1)", channel: 0, program: 80 },
  { name: "Chords (pulse 2)", channel: 1, program: 81 },
  { name: "Bass (triangle)", channel: 2, program: 38 },
  { name: "Drums (noise)", channel: 9, program: null },
];

const vlq = (n) => {
  const bytes = [n & 0x7f];
  for (let v = n >> 7; v > 0; v >>= 7) bytes.unshift((v & 0x7f) | 0x80);
  return bytes;
};

const text = (s) => Array.from(new TextEncoder().encode(s));

function chunk(id, body) {
  const len = body.length;
  return [...text(id), (len >>> 24) & 255, (len >>> 16) & 255, (len >>> 8) & 255, len & 255, ...body];
}

function track(events) {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order);
  const body = [];
  let last = 0;
  for (const e of events) {
    body.push(...vlq(Math.max(0, e.tick - last)), ...e.bytes);
    last = Math.max(last, e.tick);
  }
  body.push(0, 0xff, 0x2f, 0);
  return chunk("MTrk", body);
}

// Beat times to a tempo map that starts at the clip's first moment (MIDI time
// 0 is audio time 0, so the file lines up with the snippet in a DAW) and still
// puts bar lines on the song's bars: the beats before the first one in the
// clip are squeezed into a pickup that ends exactly where it starts.
function beatMap(beats, downbeat) {
  const first = Math.max(0, beats.findIndex((t) => t >= 0));
  const head = beats[first] ?? 0;
  // How far into its bar the first beat falls is how many pickup beats it needs.
  let pickup = (((first - downbeat) % 4) + 4) % 4;
  if (head > 0.02 && pickup === 0) pickup = 4;
  if (head <= 0.02) pickup = 0;
  const lead = Array.from({ length: pickup }, (_, j) => (head * j) / pickup);
  const b = [...lead, ...beats.slice(first)];
  if (b.length < 2) b.push(b[0] + 0.5);
  return b;
}

// Tracks: [{ name, channel, program, notes: [{ s, d, keys, v }] }], times in
// seconds of the clip. `offset` is where the clip was cut from the source.
export function writeMidi(tracks, beats, { downbeat = 0, title = "Chiptune", offset = 0 } = {}) {
  const b = beatMap(beats, downbeat);
  const period = b[b.length - 1] - b[b.length - 2] || 0.5;
  const tick = (t) => {
    let i = 0;
    while (i < b.length - 2 && b[i + 1] <= t) i += 1;
    const span = b[i + 1] - b[i] || period;
    return Math.max(0, Math.round((i + (t - b[i]) / span) * PPQ));
  };

  const meta = (type, str) => [0xff, type, ...vlq(text(str).length), ...text(str)];
  const tempo = [{ tick: 0, order: 0, bytes: meta(0x03, title) }];
  tempo.push({ tick: 0, order: 1, bytes: [0xff, 0x58, 4, 4, 2, 24, 8] });
  if (offset > 0) {
    const m = Math.floor(offset / 60);
    tempo.push({ tick: 0, order: 1, bytes: meta(0x06, `From ${m}:${(offset % 60).toFixed(1).padStart(4, "0")} of the source`) });
  }
  for (let i = 0; i < b.length - 1; i += 1) {
    const us = Math.max(1, Math.min(0xffffff, Math.round((b[i + 1] - b[i]) * 1e6)));
    tempo.push({ tick: i * PPQ, order: 2, bytes: [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255] });
  }

  const chunks = tracks.map(({ name, channel, program, notes }) => {
    const ev = [{ tick: 0, order: 0, bytes: meta(0x03, name) }];
    if (program != null) ev.push({ tick: 0, order: 1, bytes: [0xc0 | channel, program] });
    for (const n of notes) {
      const vel = Math.max(1, Math.min(127, Math.round(n.v * 127)));
      const on = tick(n.s);
      const off = Math.max(on + 1, n.d == null ? on + PPQ / 8 : tick(n.s + n.d));
      for (const k of n.keys) {
        ev.push({ tick: on, order: 3, bytes: [0x90 | channel, k, vel] });
        ev.push({ tick: off, order: 2, bytes: [0x80 | channel, k, 0] });
      }
    }
    return track(ev);
  });

  const header = chunk("MThd", [0, 1, 0, tracks.length + 1, (PPQ >> 8) & 255, PPQ & 255]);
  return new Uint8Array([...header, ...track(tempo), ...chunks.flat()]);
}

// The chip arrangement as heard: arpeggios become the block chords they stand
// for, the bass keeps its root fills.
function songTracks(song) {
  const tracks = TRACKS.map((t) => ({ ...t, notes: [] }));
  for (const e of song.events) {
    const keys = e.ch === 3 ? [DRUM_KEYS[e.kind] ?? 38] : e.arp ? e.arp.map((iv) => e.m + iv) : [e.m];
    tracks[e.ch].notes.push({ s: e.s, d: e.ch === 3 ? null : e.d, keys, v: e.v });
  }
  return tracks;
}

// The transcription itself, before any chip decisions: the melody and bass
// lines at their real pitches, the chords as held root-position triads or
// sevenths, the drums as detected, and every note Basic Pitch found.
function analysisTracks(analysis, { drums: withDrums = true } = {}) {
  const { melody, bass, chords, drums, notes, grid } = analysis;
  const line = (list) => list.map((n) => ({ s: n.start, d: n.end - n.start, keys: [n.midi], v: 0.5 + 0.5 * Math.min(1, n.amp ?? 0.6) }));
  const chordNotes = chords
    .filter((c) => c.root != null)
    .map((c) => ({ s: c.start, d: c.end - c.start, keys: QUALITIES[c.quality].map((iv) => 48 + c.root + iv), v: 0.6 }));
  const tracks = [
    { name: "Melody (transcribed)", channel: 3, program: 0, notes: line(melody) },
    { name: "Chords (transcribed)", channel: 4, program: 0, notes: chordNotes },
    { name: "Bass (transcribed)", channel: 5, program: 33, notes: line(bass) },
    { name: "All notes (Basic Pitch)", channel: 6, program: 0, notes: line(notes) },
  ];
  if (withDrums) tracks.push({ name: "Drums", channel: 9, program: null, notes: drums.map((h) => ({ s: h.time ?? grid[h.slot], d: null, keys: [DRUM_KEYS[h.kind] ?? 38], v: h.v })) });
  return tracks;
}

export function songToMidi(song, beats, { downbeat = 0, offset = 0 } = {}) {
  return writeMidi(songTracks(song), beats, { downbeat, offset, title: song.title || "Chiptune" });
}

export function analysisToMidi(analysis, { title = "Transcription", offset = 0 } = {}) {
  return writeMidi(analysisTracks(analysis), analysis.beats, { downbeat: analysis.downbeat, offset, title });
}

// Both in one file: the chip parts first, the transcription under them to
// unmute or rework.
export function conversionToMidi(song, analysis, { offset = 0 } = {}) {
  return writeMidi([...songTracks(song), ...analysisTracks(analysis, { drums: false })], analysis.beats, { downbeat: analysis.downbeat, offset, title: song.title || "Chiptune" });
}
