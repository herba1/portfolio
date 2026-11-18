import { piece } from "./_piece.mjs";
// A tracklist woven like cloth. Stir it and bold swirls through the type like ink in water.
export default piece({
  url: "/stir", ready: ".stir__canvas[data-painted]",
  beats: [
    { drag: [[0.2, 0.4], [0.5, 0.45], [0.8, 0.4]], duration: 1100, approach: 800, pause: 900 },
    { drag: [[0.7, 0.6], [0.3, 0.55]], duration: 900, approach: 500, pause: 1800 },
  ],
});
