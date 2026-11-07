import { piece } from "./_piece.mjs";
// Album covers on a ring. Drag to spin it.
export default piece({
  url: "/cover-ring", ready: ".cr__card",
  intro: { hold: 2600, zoom: 1, fade: 0, trim: 2500 },
  beats: [
    { drag: [[0.3, 0.55], [0.7, 0.55]], duration: 900, approach: 800, pause: 2000 },
    { drag: [[0.7, 0.55], [0.35, 0.55]], duration: 900, approach: 500, pause: 1800 },
  ],
});
