import { albumById } from "@/app/lab/_music/catalog";

import hills from "./hills.webp";
import night from "./night.webp";
import sunset from "./sunset.webp";

const scene = (id, image, song, albumId, view, look) => {
  const album = albumById(albumId);
  return { id, src: image.src, song, album, view, ...look };
};

export const SCENES = [
  scene("night", night, "Across the Universe", "let-it-be", "Friends by a car on a beach at night, a light pouring through the fog", {
    crop: [0, 0, 1, 1],
    focus: [0.42, 0.56],
    grade: [1.02, 1.04, 0, 1.04],
    fog: [0.3, 0.3, 0.34, 0.2],
    fogAmount: 0.86,
  }),
  scene("sunset", sunset, "Here Comes the Sun", "abbey-road", "The sun going down behind the hills, power lines across the sky", {
    crop: [0, 0, 1, 1],
    focus: [0.5, 0.9],
    grade: [1.1, 1.02, 0, 1.06],
    fog: [0.3, 0.2, 0.18, 0.12],
    fogAmount: 0.8,
  }),
  scene("hills", hills, "The Fool on the Hill", "magical-mystery-tour", "A green valley under the mountains", {
    crop: [0, 0, 1, 1],
    focus: [0.5, 0.62],
    grade: [0.96, 0.98, 0.1, 1.02],
    fog: [0.2, 0.22, 0.24, 0.16],
    fogAmount: 0.86,
  }),
];

export const RAIN_DEFAULT = 0.42;
