import { piece } from "./_piece.mjs";
// A handwritten setlist: scrub a song out with a real eraser and the ink lifts as dust.
// The eraser is the cursor, so no arrow is drawn.
export default piece({
  url: "/lab/erase", ready: ".erase__ink",
  hide: [".erase__undo"],
  hand: false,
  beats: [
    { drag: [[0.3, 0.5], [0.66, 0.5], [0.32, 0.52], [0.68, 0.51], [0.3, 0.53], [0.66, 0.52], [0.34, 0.5], [0.64, 0.53]], duration: 1700, approach: 400, pause: 300 },
    { drag: [[0.3, 0.63], [0.66, 0.63], [0.32, 0.65], [0.68, 0.64], [0.3, 0.66], [0.62, 0.65]], duration: 1300, approach: 350, pause: 2200 },
  ],
});
