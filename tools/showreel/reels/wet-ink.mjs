import { piece } from "./_piece.mjs";
// A wet brush on fibred paper: drag it slow and the ink pools, flick and it thins to a hairline.
export default piece({
  url: "/wet-ink", ready: "[data-painted]",
  beats: [
    { drag: [[0.25, 0.45], [0.38, 0.35], [0.55, 0.38], [0.62, 0.52], [0.5, 0.64], [0.35, 0.6]], duration: 1300, approach: 500, pause: 300 },
    { drag: [[0.3, 0.75], [0.75, 0.3]], duration: 250, approach: 400, pause: 2200 },
  ],
});
