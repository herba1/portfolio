import { piece } from "./_piece.mjs";
// A portrait printed in seed heads. Swipe and the seeds lift off on the wind, then drift home.
export default piece({
  url: "/lab/dandelion", ready: "canvas",
  hide: [".dandelion__faces", ".dandelion__mic"],
  beats: [
    { drag: [[0.25, 0.6], [0.5, 0.5], [0.8, 0.4]], duration: 600, approach: 800, pause: 3800 },
  ],
});
