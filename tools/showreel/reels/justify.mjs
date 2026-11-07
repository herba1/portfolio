import { piece } from "./_piece.mjs";
// A force-justified lyric block. Drag the right edge and the words reflow like a ribbon.
export default piece({
  url: "/lab/justify", ready: ".justify-handle",
  beats: [
    { press: ".justify-handle", duration: 800, settle: 150 },
    { move: { sel: ".justify-handle", at: [-14, 0.5] }, duration: 1400, arc: 0.04, pause: 400 },
    { move: { sel: ".justify-handle", at: [-4, 0.5] }, duration: 1100, arc: 0.04, pause: 200 },
    { lift: true, pause: 1200 },
  ],
});
