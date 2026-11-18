import { piece } from "./_piece.mjs";
// A light table: lay one transparency over another for a double exposure, then put the loupe on the film.
export default piece({
  url: "/lab/light-table", ready: "canvas",
  beats: [
    { drag: [[0.5, 0.86], [0.45, 0.62]], duration: 900, approach: 600, pause: 1200 },
    { drag: [[0.29, 0.84], [0.32, 0.46], [0.5, 0.45]], duration: 1500, approach: 500, pause: 1500 },
  ],
});
