import { piece } from "./_piece.mjs";
// A photo print hanging by its top edge. Press and drag the flame across it; the darks catch first.
export default piece({
  url: "/scorch", ready: ".scorch-plate[data-ready]",
  hide: ['[class*="ring"]', '[class*="controls"]'],
  beats: [
    { drag: [[0.42, 0.5], [0.52, 0.56], [0.62, 0.62]], duration: 1600, approach: 800, pause: 3500 },
  ],
});
