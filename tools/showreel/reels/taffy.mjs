import { piece } from "./_piece.mjs";
// A title in ink that pulls like sugar. Grab a letter, stretch it until the strands snap.
const W = ".taffy-stage__letter >> nth=5";
export default piece({
  url: "/taffy", ready: ".taffy[data-ready]",
  beats: [
    { press: W, duration: 800, settle: 150 },
    { move: { sel: W, at: [0.6, -2.6] }, duration: 1500, arc: 0.08, pause: 400 },
    { move: { sel: W, at: [1.4, -4.2] }, duration: 900, arc: 0.05, pause: 200 },
    { lift: true, pause: 2200 },
  ],
});
