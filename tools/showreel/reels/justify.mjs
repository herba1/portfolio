import { piece } from "./_piece.mjs";
// A paragraph that re-justifies as you drag its right edge.
export default piece({
  url: "/lab/justify", ready: ".justify-handle",
  hide: [".justify-word", ".justify-sound"],
  beats: [
    { press: ".justify-handle", duration: 600, settle: 120 },
    { move: { sel: ".justify-handle", at: [-14, 0.5] }, duration: 1000, arc: 0.04, pause: 300 },
    { move: { sel: ".justify-handle", at: [-4, 0.5] }, duration: 800, arc: 0.04, pause: 200 },
    { lift: true, pause: 1200 },
  ],
});
