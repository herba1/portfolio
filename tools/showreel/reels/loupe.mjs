import { piece } from "./_piece.mjs";
// Glass over a film print in low sun: slide it, and turn it in and out to look closer.
export default piece({
  url: "/lab/loupe", ready: "[data-ready]",
  hide: [".loupe__cards", ".loupe__range", ".loupe__zoom"],
  beats: [
    { drag: [[0.6, 0.45], [0.35, 0.42], [0.5, 0.52]], duration: 1300, approach: 600, pause: 200 },
    { scroll: -500, duration: 900, pause: 700 },
    { move: [0.42, 0.44], duration: 700, arc: 0.15, pause: 300 },
    { scroll: 500, duration: 800, pause: 900 },
  ],
});
