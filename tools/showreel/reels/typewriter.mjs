import { piece } from "./_piece.mjs";
// Revolver's liner credits on bond paper: type without hitting Return and the
// letters pile up at the margin.
export default piece({
  url: "/lab/typewriter", ready: "canvas",
  hand: false,
  css: ".typewriter-stage:focus, .typewriter-stage:focus-visible { outline: none !important; }",
  beats: [
    { focus: ".typewriter-stage" },
    { camera: { zoom: 1.3, on: [0.55, 0.5], follow: false }, pause: 400 },
    { type: " klaus voormann. and your bird can sing, you tell me that you've got everything", delay: 120, pause: 900 },
  ],
});
