import { piece } from "./_piece.mjs";
// Three badges on cotton under one low lamp: the light rakes across stitches and enamel.
export default piece({
  url: "/lab/raking-light", ready: "canvas",
  beats: [
    { move: [0.25, 0.3], duration: 600, pause: 300 },
    { move: [0.8, 0.45], duration: 1200, arc: 0.2, pause: 300 },
    { move: [0.35, 0.72], duration: 1000, arc: 0.2, pause: 700 },
  ],
});
