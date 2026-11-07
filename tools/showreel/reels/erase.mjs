import { piece } from "./_piece.mjs";
// A handwritten setlist. Scrub a song with the eraser: the ink lifts off as dust that piles up below.
export default piece({
  url: "/lab/erase", ready: ".erase__ink",
  hide: [".erase__undo"],
  beats: [
    { drag: [[0.3, 0.46], [0.62, 0.45], [0.33, 0.47], [0.64, 0.46], [0.35, 0.48], [0.62, 0.47]], duration: 2200, approach: 800, pause: 2000 },
  ],
});
