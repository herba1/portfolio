import { piece } from "./_piece.mjs";
// A field of characters in the wind: stir it, then type a word and the wind gathers it.
export default piece({
  url: "/lab/field", ready: ".field-screen[data-ready]",
  beats: [
    { move: [0.18, 0.52], duration: 500 },
    { move: [0.82, 0.46], duration: 900, arc: 0.25, pause: 150 },
    { move: [0.3, 0.62], duration: 700, arc: 0.2, pause: 200 },
    { focus: ".field-screen", pause: 100 },
    { type: "help", delay: 170 },
    { key: "Enter", pause: 3200 },
  ],
});
