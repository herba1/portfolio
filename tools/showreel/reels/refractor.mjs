import { piece } from "./_piece.mjs";
// A compact disc under a soft light. Move across it and the spectral bands sweep the tracks; flick it.
export default piece({
  url: "/lab/refractor", ready: "canvas",
  hide: [".refractor__tray"],
  beats: [
    { move: [0.3, 0.35], duration: 900, pause: 300 },
    { move: [0.72, 0.6], duration: 1600, arc: 0.2, pause: 400 },
    { drag: [[0.65, 0.5], [0.35, 0.45]], duration: 400, approach: 500, pause: 2200 },
  ],
});
