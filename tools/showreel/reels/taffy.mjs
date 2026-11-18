import { piece } from "./_piece.mjs";
// A song title in ink that pulls like sugar: stretch a letter, let it snap home, tap for the next title.
const W = ".taffy-stage__letter >> nth=4";
export default piece({
  url: "/taffy", ready: ".taffy[data-ready]",
  stage: { sel: ".taffy-stage__letters button", pad: 0.06 },
  beats: [
    { press: W, duration: 600, settle: 120 },
    { move: { sel: W, at: [0.6, -1.8] }, duration: 900, arc: 0.08, pause: 250 },
    { move: { sel: W, at: [1.3, -3] }, duration: 600, arc: 0.05, pause: 150 },
    { lift: true, pause: 1400 },
    { click: [0.5, 0.75], duration: 500, settle: 100, pause: 2200 },
  ],
});
