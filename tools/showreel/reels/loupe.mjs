import { piece } from "./_piece.mjs";
// A frameless loupe over a film print in low sun. Slide it and the glass bends the print at its edge.
export default piece({
  url: "/lab/loupe", ready: "[data-ready]",
  hide: [".loupe__cards", ".loupe__range"],
  beats: [
    { drag: [[0.5, 0.45], [0.3, 0.4], [0.62, 0.52], [0.45, 0.48]], duration: 3000, approach: 800, pause: 1300 },
  ],
});
