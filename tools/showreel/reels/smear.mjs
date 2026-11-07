import { piece } from "./_piece.mjs";
// A poem that keeps re-setting itself. Drag across it and the words burn a long-exposure trail; hold to scatter.
export default piece({
  url: "/lab/smear", ready: "canvas, p",
  hide: ['[class*="play"]'],
  beats: [
    { drag: [[0.2, 0.3], [0.5, 0.42], [0.8, 0.55]], duration: 1300, approach: 700, pause: 1000 },
    { hold: [0.5, 0.5], press: 1300, duration: 800, pause: 1800 },
  ],
});
