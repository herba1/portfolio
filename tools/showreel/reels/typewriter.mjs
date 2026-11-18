import { piece } from "./_piece.mjs";
// Revolver's liner credits on bond paper: type without hitting Return and the letters pile up at the margin.
export default piece({
  url: "/lab/typewriter", ready: "canvas",
  beats: [
    { camera: { zoom: 1.6, on: [0.4, 0.62], follow: false }, pause: 500 },
    { type: "and your bird can sing, you tell me that", delay: 150, pause: 600 },
    { camera: "reset", pause: 900 },
  ],
});
