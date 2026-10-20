import { albumById } from "@/app/lab/_music/catalog";

const m = (text) => {
  const [a, b] = text.split(":").map(Number);
  return a * 60 + b;
};

const track = (album, title, duration, bpm, sections) => {
  const a = albumById(album);
  return {
    id: `${album}-${title}`,
    title,
    album: a.title,
    artist: a.artist,
    year: a.year,
    cover: a.cover,
    duration,
    bpm,
    sections: sections.map(([at, name, from, to = from]) => ({ start: m(at), name, from, to })),
  };
};

export const TRACKS = [
  track("sgt-pepper", "A Day in the Life", 333, 80, [
    ["0:00", "Intro", 0.26],
    ["0:13", "Verse 1", 0.36, 0.4],
    ["0:45", "Verse 2", 0.42, 0.46],
    ["1:15", "Verse 3", 0.46, 0.52],
    ["1:43", "First crescendo", 0.3, 1],
    ["2:16", "Middle eight", 0.62, 0.66],
    ["2:49", "Dream", 0.56, 0.5],
    ["3:19", "Last verse", 0.5, 0.54],
    ["3:47", "Second crescendo", 0.3, 1],
    ["4:20", "Final chord", 1, 0.04],
    ["5:10", "Run-out", 0.04, 0.02],
  ]),
  track("abbey-road", "Come Together", 259, 82, [
    ["0:00", "Intro", 0.5, 0.55],
    ["0:12", "Verse 1", 0.6, 0.62],
    ["0:40", "Verse 2", 0.62, 0.66],
    ["1:05", "Chorus", 0.78, 0.8],
    ["1:20", "Verse 3", 0.64, 0.66],
    ["1:48", "Chorus", 0.8, 0.82],
    ["2:00", "Guitar solo", 0.74, 0.86],
    ["2:30", "Verse 4", 0.66, 0.68],
    ["2:57", "Chorus", 0.84, 0.86],
    ["3:12", "Outro", 0.86, 0.2],
  ]),
  track("abbey-road", "Here Comes the Sun", 185, 129, [
    ["0:00", "Intro", 0.34, 0.4],
    ["0:15", "Chorus", 0.56, 0.6],
    ["0:29", "Verse 1", 0.5, 0.54],
    ["0:44", "Chorus", 0.6, 0.62],
    ["0:58", "Verse 2", 0.54, 0.56],
    ["1:13", "Chorus", 0.62, 0.64],
    ["1:28", "Bridge", 0.5, 0.82],
    ["2:00", "Verse 3", 0.56, 0.58],
    ["2:15", "Chorus", 0.66, 0.7],
    ["2:44", "Outro", 0.6, 0.1],
  ]),
];

export const sectionAt = (t, sections) => {
  let i = 0;
  while (i + 1 < sections.length && sections[i + 1].start <= t) i += 1;
  return i;
};
