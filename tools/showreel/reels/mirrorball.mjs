import { piece } from "./_piece.mjs";
// Flecks from a mirrorball, each carrying a piece of the cover. Throw it faster, then let it run.
export default piece({
  url: "/lab/mirrorball", ready: "[data-ready]",
  hide: [".mirrorball-gels"],
  beats: [
    { drag: [[0.3, 0.5], [0.75, 0.5]], duration: 450, approach: 800, pause: 2200 },
    { drag: [[0.3, 0.52], [0.78, 0.5]], duration: 400, approach: 600, pause: 2400 },
  ],
});
