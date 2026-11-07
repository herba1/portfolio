import { piece } from "./_piece.mjs";
// Every line at its own distance from the lens. Turn the focus ring and the sharp line travels.
export default piece({
  url: "/lab/focus-pull", ready: "[class*=ring], canvas",
  beats: [
    { drag: [[0.3, 0.84], [0.72, 0.84]], duration: 1700, approach: 800, pause: 700 },
    { drag: [[0.7, 0.84], [0.42, 0.84]], duration: 1300, approach: 400, pause: 700 },
    { click: [0.5, 0.36], duration: 900, pause: 1300 },
  ],
});
