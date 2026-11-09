import { piece } from "./_piece.mjs";
// The line saves itself as a JPEG over and over. Drag across it to go through the copies.
export default piece({
  url: "/lab/generation-loss", ready: "canvas, img",
  beats: [
    { drag: [[0.3, 0.42], [0.78, 0.43]], duration: 1800, approach: 700, pause: 900 },
    { drag: [[0.75, 0.42], [0.35, 0.44]], duration: 1300, approach: 400, pause: 1000 },
  ],
});
