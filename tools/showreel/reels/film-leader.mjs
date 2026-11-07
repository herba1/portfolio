import { piece } from "./_piece.mjs";
// A 35mm canister. Pull the leader and the strip of negatives unspools; push it back and it winds in.
export default piece({
  url: "/lab/film-leader", ready: "canvas",
  hide: [".film-leader__toggle"],
  beats: [
    { drag: [[0.5, 0.58], [0.58, 0.74], [0.6, 0.9]], duration: 1800, approach: 800, pause: 1300 },
    { drag: [[0.6, 0.88], [0.52, 0.62]], duration: 1300, approach: 500, pause: 1300 },
  ],
});
