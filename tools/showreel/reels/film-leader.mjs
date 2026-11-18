import { piece } from "./_piece.mjs";
// A 35mm canister: pull the leader and the negative unspools; push it back in.
export default piece({
  url: "/lab/film-leader", ready: "canvas",
  hide: [".film-leader__toggle"],
  beats: [
    { drag: [[0.5, 0.58], [0.58, 0.74], [0.6, 0.9]], duration: 1100, approach: 600, pause: 1100 },
    { drag: [[0.6, 0.88], [0.52, 0.62]], duration: 900, approach: 400, pause: 1300 },
  ],
});
