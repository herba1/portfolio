import { piece } from "./_piece.mjs";
// A wall of flowers. Tap to change the frame.
export default piece({
  url: "/blobs", ready: "canvas[data-painted]",
  beats: [
    { click: [0.5, 0.5], duration: 800, settle: 200, pause: 2500 },
    { click: [0.4, 0.42], duration: 700, settle: 200, pause: 2500 },
  ],
});
