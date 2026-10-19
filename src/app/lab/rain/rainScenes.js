import { albumById } from "@/app/lab/_music/catalog";

import hills from "./hills.webp";
import night from "./night.webp";
import sunset from "./sunset.webp";

const scene = (id, image, song, albumId, view, look) => {
  const album = albumById(albumId);
  return { id, src: image.src, song, album, view, ...look };
};

export const SCENES = [
  scene("sunset", sunset, "Here Comes the Sun", "abbey-road", "The sun going down behind the hills, power lines across the sky", {
    crop: [0, 0, 1, 1],
    focus: [0.5, 0.8],
    grade: [1.3, 0.98, 0, 1.18],
    fog: [0.8, 0.74, 0.7, 0.4],
    fogAmount: 0.9,
  }),
  scene("night", night, "Across the Universe", "let-it-be", "Friends by a car on a beach at night, a light pouring through the fog", {
    crop: [0, 0.08, 1, 0.86],
    focus: [0.4, 0.6],
    grade: [1.18, 0.82, 0, 1.12],
    fog: [0.3, 0.31, 0.34, 0.46],
    fogAmount: 0.9,
  }),
  scene("hills", hills, "The Fool on the Hill", "magical-mystery-tour", "A green valley under the mountains", {
    crop: [0.03, 0.03, 0.94, 0.86],
    focus: [0.5, 0.5],
    grade: [1.16, 0.96, 0, 1.1],
    fog: [0.66, 0.7, 0.7, 0.42],
    fogAmount: 0.9,
  }),
];

export const RAIN_DEFAULT = 0.42;
