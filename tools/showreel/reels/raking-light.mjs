import { piece } from "./_piece.mjs";
// Three badges on cotton, one lamp in your hand held low: the light rakes across stitches and enamel.
export default piece({
  url: "/lab/raking-light", ready: "canvas",
  hide: [".raking-light-range", "input"],
  beats: [
    { move: [0.25, 0.3], duration: 900, pause: 400 },
    { move: [0.8, 0.45], duration: 1700, arc: 0.2, pause: 500 },
    { move: [0.35, 0.72], duration: 1500, arc: 0.2, pause: 900 },
  ],
});
