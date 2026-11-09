import { piece } from "./_piece.mjs";
// A cover printed in wet ink. Drag through it and the ink smears along your path.
export default piece({
  url: "/lab/ink-drag", ready: "[data-ready]",
  hide: [".ink-drag__records", ".ink-drag__inks", ".ink-drag__fresh"],
  beats: [
    { drag: [[0.3, 0.32], [0.5, 0.45], [0.72, 0.4], [0.6, 0.6]], duration: 2200, approach: 800, pause: 1600 },
  ],
});
