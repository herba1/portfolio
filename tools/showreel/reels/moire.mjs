import { piece } from "./_piece.mjs";
// Two line screens over each other: drag the top one and a hidden picture comes and goes.
export default piece({
  url: "/lab/moire", ready: ".moire-screen[data-ready]",
  beats: [
    { drag: [[0.3, 0.5], [0.5, 0.52], [0.72, 0.56]], duration: 1100, approach: 600, pause: 800 },
    { drag: [[0.7, 0.5], [0.4, 0.46]], duration: 900, approach: 400, pause: 1200 },
  ],
});
