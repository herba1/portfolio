import { piece } from "./_piece.mjs";
// A deck of recently played covers. Fan through it.
export default piece({
  url: "/deck", ready: "[data-ready]",
  hide: [".btn"],
  beats: [
    { drag: [[0.65, 0.55], [0.35, 0.55]], duration: 700, approach: 800, pause: 1300 },
    { drag: [[0.65, 0.55], [0.35, 0.55]], duration: 700, approach: 500, pause: 1300 },
    { drag: [[0.35, 0.55], [0.7, 0.55]], duration: 700, approach: 500, pause: 1400 },
  ],
});
