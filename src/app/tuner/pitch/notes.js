// 12-tone equal temperament note math. Pure — no React, no DOM.
// MIDI note 69 == A4. Default reference A4 = 440 Hz, configurable for
// orchestras / vintage instruments (~430–450).

export const NOTE_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
];

// Whether a chromatic note name carries an accidental (drives the ♯ indicator).
export const IS_SHARP = NOTE_NAMES.map((n) => n.includes("#"));

const LETTER_SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** MIDI number → frequency in Hz. */
export function noteToFreq(midi, a4 = 440) {
  return a4 * Math.pow(2, (midi - 69) / 12);
}

/** Frequency → fractional MIDI number (e.g. 69.5 = halfway above A4). */
export function freqToMidiFloat(freq, a4 = 440) {
  return 69 + 12 * Math.log2(freq / a4);
}

/**
 * Frequency → nearest note.
 * Returns { name, octave, cents, midi, midiFloat, freq, isSharp, label }
 * where cents ∈ [-50, +50] is the deviation from the nearest semitone.
 * Returns null for non-positive / falsy input.
 */
export function freqToNote(freq, a4 = 440) {
  if (!freq || freq <= 0 || !Number.isFinite(freq)) return null;
  const midiFloat = freqToMidiFloat(freq, a4);
  const midi = Math.round(midiFloat);
  const cents = Math.round((midiFloat - midi) * 100);
  const idx = ((midi % 12) + 12) % 12;
  const name = NOTE_NAMES[idx];
  const octave = Math.floor(midi / 12) - 1;
  return {
    name,
    octave,
    cents,
    midi,
    midiFloat,
    freq,
    isSharp: IS_SHARP[idx],
    label: `${name}${octave}`,
  };
}

/** MIDI number → { name, octave, label, isSharp }. */
export function midiToNote(midi) {
  const idx = ((midi % 12) + 12) % 12;
  const name = NOTE_NAMES[idx];
  const octave = Math.floor(midi / 12) - 1;
  return { name, octave, label: `${name}${octave}`, isSharp: IS_SHARP[idx] };
}

/** Parse "E2" / "A#3" / "Db4" / "C-1" → MIDI number (or null). */
export function noteNameToMidi(str) {
  const m = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(String(str).trim());
  if (!m) return null;
  const letter = m[1].toUpperCase();
  const accidental = m[2];
  const octave = parseInt(m[3], 10);
  let semitone = LETTER_SEMITONE[letter];
  if (accidental === "#") semitone += 1;
  else if (accidental === "b") semitone -= 1;
  return semitone + (octave + 1) * 12;
}

/** Signed cents between a played frequency and a target frequency. */
export function centsBetween(freq, targetFreq) {
  return 1200 * Math.log2(freq / targetFreq);
}

/** Format cents for the display: "+0", "-12", "+7". */
export function formatCents(cents) {
  const rounded = Math.round(cents);
  return rounded > 0 ? `+${rounded}` : `${rounded}`;
}
