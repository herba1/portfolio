import { piece } from "./_piece.mjs";
// Pixel-sorted Times Square with live blob tracking. Anything bright gets a box, the pointer too.
export default piece({
  url: "/lab/blob-track", ready: "canvas",
  hide: ['[class*="controls"]', '[class*="threshold"]', "input", "label"],
  beats: [
    { move: [0.3, 0.38], duration: 900, pause: 500 },
    { move: [0.7, 0.58], duration: 1600, arc: 0.2, pause: 600 },
    { move: [0.4, 0.66], duration: 1200, arc: 0.2, pause: 800 },
  ],
});
