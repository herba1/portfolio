import { albumById } from "@/app/lab/_music/catalog";

const LABELS = {
  early: { paper: "#1d1b19", ink: "#f1e9d6" },
  middle: { paper: "#ece4cf", ink: "#1d1b19" },
  late: { paper: "#4a8a3f", ink: "#f4eedd" },
};

const ORDER = [
  "a-hard-days-night",
  "beatles-for-sale",
  "help",
  "rubber-soul",
  "revolver",
  "sgt-pepper",
  "magical-mystery-tour",
  "abbey-road",
  "let-it-be",
];

const SHORT = { "sgt-pepper": "Sgt. Pepper" };

export const SLEEVES = ORDER.map((id) => {
  const album = albumById(id);
  const era = album.year < 1965 ? "early" : album.year < 1969 ? "middle" : "late";
  return {
    id,
    src: album.cover,
    title: album.title,
    short: SHORT[id] || album.title,
    artist: album.artist,
    year: album.year,
    tracks: album.tracks,
    label: LABELS[era],
  };
});

export const START_INDEX = ORDER.indexOf("revolver");
