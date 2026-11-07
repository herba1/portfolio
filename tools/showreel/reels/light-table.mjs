import { piece } from "./_piece.mjs";
// A light table spread with film. Slide a transparency over another and they double-expose.
export default piece({
  url: "/lab/light-table", ready: "canvas",
  beats: [
    { drag: [[0.65, 0.82], [0.5, 0.62], [0.42, 0.42]], duration: 1800, approach: 800, pause: 1400 },
    { drag: [[0.42, 0.42], [0.55, 0.6]], duration: 1200, approach: 300, pause: 1200 },
  ],
});
