import { piece } from "./_piece.mjs";
// A field of characters on curl noise. Move through it to stir it, type and the wind gathers the word.
export default piece({
  url: "/lab/field", ready: "canvas",
  beats: [
    { move: [0.18, 0.52], duration: 700 },
    { move: [0.82, 0.46], duration: 1300, arc: 0.25, pause: 200 },
    { move: [0.3, 0.6], duration: 1000, arc: 0.2, pause: 300 },
    { type: "help", delay: 140 },
    { key: "Enter", pause: 3200 },
  ],
});
