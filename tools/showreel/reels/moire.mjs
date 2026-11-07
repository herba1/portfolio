import { piece } from "./_piece.mjs";
// Two line screens; the hidden picture only shows where they interfere. Slide the top one.
export default piece({
  url: "/lab/moire", ready: "canvas",
  beats: [
    { drag: [[0.3, 0.5], [0.5, 0.52], [0.72, 0.56]], duration: 1500, approach: 700, pause: 900 },
    { drag: [[0.7, 0.5], [0.4, 0.46]], duration: 1100, approach: 500, pause: 1200 },
  ],
});
