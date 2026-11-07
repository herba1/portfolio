import { piece } from "./_piece.mjs";
// Revolver's liner credits on bond paper; every key bites the sheet with its own worn ink.
export default piece({
  url: "/lab/typewriter", ready: "canvas",
  beats: [
    { camera: { zoom: 1.8, on: [0.32, 0.6], follow: false }, pause: 900 },
    { type: "and your bird can sing", delay: 120, pause: 400 },
    { key: "Enter", pause: 1400 },
    { camera: "reset", pause: 600 },
  ],
});
