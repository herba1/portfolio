import { piece } from "./_piece.mjs";
// A poem that keeps re-setting itself: run the hand through it and the words streak like a long exposure.
export default piece({
  url: "/lab/smear", ready: "canvas",
  hide: [".smear-button"],
  intro: { hold: 300, zoom: 1, fade: 0, trim: 0 },     // keep its opening
  beats: [
    { wait: 1800 },
    { move: [0.3, 0.35], duration: 500 },
    { move: [0.7, 0.45], duration: 600, arc: 0.15 },
    { move: [0.35, 0.6], duration: 600, arc: 0.15, pause: 200 },
    { drag: [[0.3, 0.3], [0.72, 0.5]], duration: 600, approach: 400, pause: 1200 },
    { hold: [0.5, 0.5], press: 1000, duration: 500, pause: 1800 },
  ],
});
