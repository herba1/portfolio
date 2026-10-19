import beams from "./beams.jpg";
import dusk from "./dusk.jpg";
import glow from "./glow.jpg";
import sea from "./sea.jpg";

export const SONG = { title: "friday", artist: "herb" };

export const PHOTOS = {
  beams: { src: beams.src, focus: [0.42, 0.5], grade: { lift: 0.035, sat: 0.86, expo: 0.8, gamma: 1.28, tint: [1.03, 1, 0.94] }, threshold: 0.58, bloom: 0.5 },
  dusk: { src: dusk.src, focus: [0.5, 0.42], grade: { lift: 0.03, sat: 0.92, expo: 0.86, gamma: 1.3, tint: [1.04, 0.98, 0.94] }, threshold: 0.62, bloom: 0.42 },
  sea: { src: sea.src, focus: [0.4, 0.5], grade: { lift: 0.03, sat: 0.62, expo: 0.62, gamma: 1.55, tint: [0.78, 0.9, 1.12] }, threshold: 0.7, bloom: 0.32 },
  glow: { src: glow.src, focus: [0.5, 0.5], grade: { lift: 0.02, sat: 0.9, expo: 0.72, gamma: 1.5, tint: [1, 0.96, 1.02] }, threshold: 0.66, bloom: 0.38 },
};

export const VERSES = [
  { lines: ["you don’t have to be", "anyone tonight"], photo: "beams", y: 0.3 },
  { lines: ["nothing good comes easy", "but it comes"], photo: "dusk", y: 0.36 },
  { lines: ["i keep your voice", "on the walk home"], photo: "sea", y: 0.38 },
  { lines: ["the whole point is not knowing", "and going anyway"], photo: "glow", y: 0.46 },
  { lines: ["we can stay out till", "the streetlights go soft"], photo: "beams", y: 0.3 },
  { lines: ["it will take a while", "to feel like this again"], photo: "dusk", y: 0.36 },
  { lines: ["so leave the window open", "let the cold come in"], photo: "sea", y: 0.38 },
  { lines: ["still here?"], photo: "glow", y: 0.46 },
];

export const STYLES = [
  { id: "block", label: "Block" },
  { id: "serif", label: "Serif" },
  { id: "caption", label: "Caption" },
];
