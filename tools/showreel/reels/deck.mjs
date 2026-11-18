import { piece } from "./_piece.mjs";
// Your recent covers on a stack: flick through, then click to fan them out, and back.
export default piece({
  url: "/deck", ready: "[data-ready]",
  beats: [
    { drag: [[0.6, 0.5], [0.3, 0.5]], duration: 380, approach: 600, pause: 900 },
    { drag: [[0.6, 0.5], [0.3, 0.5]], duration: 380, approach: 400, pause: 1100 },
    { click: [0.5, 0.5], duration: 500, settle: 120, pause: 2400 },
    { drag: [[0.7, 0.5], [0.3, 0.5]], duration: 450, approach: 400, pause: 1400 },
    { click: [0.5, 0.5], duration: 400, settle: 120, pause: 2000 },
  ],
});
