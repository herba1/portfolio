// Tuning presets + helpers. Pure — no React, no DOM.
import { noteNameToMidi, midiToNote, noteToFreq, centsBetween } from "./pitch/notes";

// Build a tuning from low→high note names. Each string carries its MIDI number
// (the absolute, A4-independent identity) — target Hz is derived per-A4.
function def(id, label, notes, type = "guitar") {
  return {
    id,
    label,
    type,
    strings: notes.map((nm) => {
      const midi = noteNameToMidi(nm);
      const { name, octave, isSharp, label: noteLabel } = midiToNote(midi);
      return { midi, name, octave, isSharp, label: noteLabel };
    }),
  };
}

export const TUNINGS = {
  guitarStandard: def("guitarStandard", "Guitar · Standard", [
    "E2",
    "A2",
    "D3",
    "G3",
    "B3",
    "E4",
  ]),
  dropD: def("dropD", "Guitar · Drop D", ["D2", "A2", "D3", "G3", "B3", "E4"]),
  halfStepDown: def("halfStepDown", "Guitar · ½ Step Down", [
    "D#2",
    "G#2",
    "C#3",
    "F#3",
    "A#3",
    "D#4",
  ]),
  openG: def("openG", "Guitar · Open G", ["D2", "G2", "D3", "G3", "B3", "D4"]),
  bassStandard: def(
    "bassStandard",
    "Bass · Standard",
    ["E1", "A1", "D2", "G2"],
    "bass"
  ),
  ukulele: def("ukulele", "Ukulele · GCEA", ["G4", "C4", "E4", "A4"], "ukulele"),
  violin: def("violin", "Violin · GDAE", ["G3", "D4", "A4", "E5"], "violin"),
  chromatic: {
    id: "chromatic",
    label: "Chromatic",
    type: "chromatic",
    strings: [],
  },
};

export const TUNING_LIST = Object.values(TUNINGS);
export const DEFAULT_TUNING_ID = "guitarStandard";

export function getTuning(id) {
  return TUNINGS[id] || TUNINGS[DEFAULT_TUNING_ID];
}

/** Attach live target frequencies (depends on the A4 reference). */
export function stringTargets(tuning, a4 = 440) {
  return tuning.strings.map((s) => ({ ...s, freq: noteToFreq(s.midi, a4) }));
}

/** Lowest expected frequency in a tuning — used to size the analyser window. */
export function lowestFreq(tuning, a4 = 440) {
  if (!tuning.strings.length) return 55; // chromatic: assume down to ~A1
  const minMidi = Math.min(...tuning.strings.map((s) => s.midi));
  return noteToFreq(minMidi, a4);
}

/**
 * Nearest string (by absolute cents distance) to a detected frequency.
 * Returns { index, string, cents, targetFreq } or null.
 */
export function nearestStringInTuning(freq, tuning, a4 = 440) {
  if (!freq || !tuning.strings.length) return null;
  let best = null;
  let bestAbs = Infinity;
  for (let i = 0; i < tuning.strings.length; i++) {
    const targetFreq = noteToFreq(tuning.strings[i].midi, a4);
    const cents = centsBetween(freq, targetFreq);
    const abs = Math.abs(cents);
    if (abs < bestAbs) {
      bestAbs = abs;
      best = { index: i, string: tuning.strings[i], cents, targetFreq };
    }
  }
  return best;
}
