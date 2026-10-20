export const SONG = {
  title: "Low Tide",
  artist: "Marlowe Street",
  key: "E major",
  bpm: 112,
  meter: "4/4",
};

export const SECTIONS = [
  { id: "intro", name: "Intro", plays: 1, bars: [["E"], ["E"], ["A"], ["B"]] },
  { id: "verse", name: "Verse", plays: 2, bars: [["E"], ["C♯m"], ["A"], ["B"], ["E"], ["C♯m"], ["A", "B"], ["E"]] },
  { id: "chorus", name: "Chorus", plays: 2, bars: [["A"], ["B"], ["G♯m"], ["C♯m"], ["A"], ["B"], ["E"], ["E"]] },
  { id: "bridge", name: "Bridge", plays: 1, bars: [["C♯m"], ["B"], ["A"], ["A"], ["C♯m"], ["B"], ["A"], ["B7"]] },
  { id: "outro", name: "Outro", plays: 1, bars: [["E"], ["A"], ["E"], ["E"]] },
];

export function length(section) {
  const seconds = Math.round((section.bars.length * section.plays * 4 * 60) / SONG.bpm);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
