import { piece } from "./_piece.mjs";
// Real covers fly in onto a ring of thick boards; drag to spin it.
export default piece({
  url: "/cover-ring", ready: ".cr__card",
  intro: { hold: 300, zoom: 1, fade: 0, trim: 0 },   // the fly-in is the best part: keep it
  beats: [
    { wait: 2600 },
    { drag: [[0.3, 0.55], [0.72, 0.55]], duration: 650, approach: 600, pause: 1600 },
    { drag: [[0.72, 0.55], [0.32, 0.55]], duration: 650, approach: 400, pause: 1600 },
  ],
});
