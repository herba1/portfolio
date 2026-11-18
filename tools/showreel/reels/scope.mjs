import { piece } from "./_piece.mjs";
// An oscilloscope in XY mode. The beam morphs from word to shape to word on
// its own, then you type a word and it bends into that, and Escape lets it
// melt back into the cycle.
export default piece({
  url: "/lab/scope", ready: ".scope-screen[data-ready]",
  hand: false,
  beats: [
    { wait: 7400 },
    { focus: ".scope-screen", pause: 200 },
    { type: "hey jude", delay: 170 },
    { wait: 1800 },
    { key: "Escape", pause: 3600 },
  ],
});
