import { piece } from "./_piece.mjs";
// A portrait printed in seed heads. Swipe and the seeds lift off on the wind, then drift home.
export default piece({
  url: "/lab/dandelion", ready: "canvas",
  hide: [".dandelion__faces", ".dandelion__mic"],
  beats: [
    { move: [0.25, 0.55], duration: 800, pause: 300 },
    { move: [0.78, 0.42], duration: 500, arc: 0.1, pause: 3500 },
  ],
});
