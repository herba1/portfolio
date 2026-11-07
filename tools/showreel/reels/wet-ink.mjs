import { piece } from "./_piece.mjs";
// A sheet that takes ink like paper. Draw a stroke and it pools, feathers and dries.
export default piece({
  url: "/wet-ink", ready: ".wi-sheet[data-painted]",
  beats: [
    { drag: [[0.25, 0.45], [0.38, 0.35], [0.55, 0.38], [0.62, 0.52], [0.5, 0.64], [0.35, 0.6]], duration: 2000, approach: 800, pause: 2200 },
  ],
});
