// The records this player plays: four invented releases whose sleeves are
// type and flat colour, drawn by Sleeve.jsx rather than loaded as photos, so
// the open panel reads as one graphic language, a printed sleeve beside a
// flush-left type column, and the white figures stay the loudest thing on it.
// Every track is on a different sleeve, so the toast's thumbnail changes
// when it announces the next one.
//
// `sleeve` picks the artwork; `tint` is the waveform's colour, the sleeve's
// own field lifted to hold on black; `dur` is the track's length in seconds.

export const TRACKS = [
  {
    id: "raster",
    title: "Halbton",
    artist: "Kern Ensemble",
    album: "Raster",
    sleeve: "raster",
    tint: "hsl(11 82% 66%)",
    dur: 221,
  },
  {
    id: "vestibule",
    title: "Vestibule",
    artist: "Section Nine",
    album: "Vestibule",
    cat: "041",
    sleeve: "door",
    tint: "hsl(229 78% 74%)",
    dur: 254,
  },
  {
    id: "nordlys",
    title: "Kaldt lys",
    artist: "Ilse Dahl Trio",
    album: "Nordlys",
    sleeve: "rule",
    tint: "hsl(60 6% 84%)",
    dur: 318,
  },
  {
    id: "linie",
    title: "Gerade",
    artist: "Linie",
    album: "Parallel",
    sleeve: "bars",
    tint: "hsl(45 86% 64%)",
    dur: 197,
  },
];
