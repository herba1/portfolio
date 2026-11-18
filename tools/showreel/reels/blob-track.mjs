import { piece } from "./_piece.mjs";
// A night street under blob tracking: the hand drags the threshold of what gets boxed.
export default piece({
  url: "/lab/blob-track", ready: "canvas",
  beats: [
    { move: [0.3, 0.38], duration: 600, pause: 300 },
    { move: [0.7, 0.58], duration: 1100, arc: 0.2, pause: 400 },
    { move: [0.4, 0.66], duration: 900, arc: 0.2, pause: 800 },
  ],
});
