// A song (arrange.js) as a Standard MIDI File: one track per chip channel, and
// a tempo map that follows the tracked beats so every note lands on the grid
// in a DAW. Arpeggios are written as the block chords they stand for.

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

// `downbeat` is the index of the first bar's first beat in `beats`. The file
// starts on the bar that contains the clip's first moment, so bar lines in a
// DAW fall where the song's bars do.
export function songToMidi(song, beats, downbeat = 0) {
  const b = beats.slice();
  const period = b.length > 1 ? b[1] - b[0] : 0.5;
  let lead = ((downbeat % 4) + 4) % 4;
  while (b[0] > 0 || lead % 4 !== 0) {
    b.unshift(b[0] - period);
    lead += 1;
  }
  const tick = (t) => {
    let i = 0;
    while (i < b.length - 2 && b[i + 1] <= t) i += 1;
    const span = b[i + 1] - b[i] || period;
    return Math.max(0, Math.round((i + (t - b[i]) / span) * PPQ));
  };

  const tempo = [{ tick: 0, order: 0, bytes: [0xff, 0x03, ...vlq(text(song.title || "Chiptune").length), ...text(song.title || "Chiptune")] }];
  tempo.push({ tick: 0, order: 1, bytes: [0xff, 0x58, 4, 4, 2, 24, 8] });
  for (let i = 0; i < b.length - 1; i += 1) {
    const us = Math.round((b[i + 1] - b[i]) * 1e6);
    tempo.push({ tick: i * PPQ, order: 2, bytes: [0xff, 0x51, 3, (us >> 16) & 255, (us >> 8) & 255, us & 255] });
  }

  const tracks = TRACKS.map(({ name, channel, program }) => {
    const ev = [{ tick: 0, order: 0, bytes: [0xff, 0x03, ...vlq(text(name).length), ...text(name)] }];
    if (program != null) ev.push({ tick: 0, order: 1, bytes: [0xc0 | channel, program] });
    return { channel, ev };
  });
  for (const e of song.events) {
    const t = tracks[e.ch];
    const vel = Math.max(1, Math.min(127, Math.round(e.v * 127)));
    const keys = e.ch === 3 ? [DRUM_KEYS[e.kind] ?? 38] : e.arp ? e.arp.map((iv) => e.m + iv) : [e.m];
    const on = tick(e.s);
    const off = Math.max(on + 1, e.ch === 3 ? on + PPQ / 8 : tick(e.s + e.d));
    for (const k of keys) {
      t.ev.push({ tick: on, order: 3, bytes: [0x90 | t.channel, k, vel] });
      t.ev.push({ tick: off, order: 2, bytes: [0x80 | t.channel, k, 0] });
    }
  }

  const header = chunk("MThd", [0, 1, 0, TRACKS.length + 1, (PPQ >> 8) & 255, PPQ & 255]);
  return new Uint8Array([...header, ...track(tempo), ...tracks.flatMap((t) => track(t.ev))]);
}
