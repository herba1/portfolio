import { albumById } from "@/app/lab/_music/catalog";

const LABELS = {
  early: { paper: "#1b1a19", ink: "#efe6d2" },
  middle: { paper: "#e9e2cf", ink: "#1a1a1a" },
  late: { paper: "#3f7d3a", ink: "#f2ecdc" },
};

const ORDER = [
  ["please-please-me", { wear: 0.75, gloss: 0.45, price: "$22" }],
  ["with-the-beatles", { wear: 0.6, gloss: 0.6 }],
  ["a-hard-days-night", { wear: 0.55, gloss: 0.55, price: "$18" }],
  ["revolver", { wear: 0.4, gloss: 0.7 }],
  ["abbey-road", { wear: 0.35, gloss: 0.75, price: "$24" }],
  ["rubber-soul", { wear: 0.5, gloss: 0.65 }],
  ["sgt-pepper", { wear: 0.3, gloss: 0.85 }],
  ["help", { wear: 0.55, gloss: 0.6, price: "$16" }],
  ["let-it-be", { wear: 0.4, gloss: 0.7 }],
  ["magical-mystery-tour", { wear: 0.45, gloss: 0.75 }],
  ["white-album", { wear: 0.65, gloss: 0.2, price: "$30" }],
  ["beatles-for-sale", { wear: 0.6, gloss: 0.5 }],
];

export const SLEEVES = ORDER.map(([id, look]) => {
  const album = albumById(id);
  const era = album.year < 1965 ? "early" : album.year < 1968 ? "middle" : "late";
  const short = album.title.startsWith("Sgt.") ? "Sgt. Pepper" : album.title;
  return {
    kind: "cover",
    src: album.cover,
    artist: album.artist,
    title: album.title,
    cat: String(album.year),
    year: album.year,
    tracks: album.tracks,
    focus: 0.5,
    ...look,
    label: { ...LABELS[era], lines: [album.artist, short] },
  };
});
