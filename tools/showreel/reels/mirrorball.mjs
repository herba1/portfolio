import { piece } from "./_piece.mjs";
// Flecks from an unseen mirrorball: throw it faster one way, then back the other.
export default piece({
  url: "/lab/mirrorball", ready: "[data-ready]",
  hide: [".mirrorball-gels"],
  beats: [
    { drag: [[0.28, 0.5], [0.78, 0.48]], duration: 300, approach: 600, pause: 1800 },
    { drag: [[0.75, 0.52], [0.22, 0.5]], duration: 300, approach: 400, pause: 2000 },
  ],
});
