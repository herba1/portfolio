import { piece } from "./_piece.mjs";
// Album portraits in seed heads: swipe and they blow away, leave them and they drift home.
export default piece({
  url: "/lab/dandelion", ready: '.dandelion[data-phase="ready"]',
  beats: [
    { drag: [[0.25, 0.62], [0.5, 0.5], [0.82, 0.4]], duration: 550, approach: 700, pause: 600 },
    { move: [0.84, 0.86], duration: 600, pause: 8500 },   // off the head, and let every seed land
  ],
});
