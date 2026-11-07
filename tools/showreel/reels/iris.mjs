import { piece } from "./_piece.mjs";
// Nine aperture blades over a stream on film. Turn the ring: the sun glints fall from soft discs into stars.
export default piece({
  url: "/lab/iris", ready: "[data-ready]",
  hide: [".iris-own"],
  beats: [
    { drag: [[0.6, 0.2], [0.78, 0.27], [0.88, 0.42], [0.88, 0.56]], duration: 2000, approach: 800, pause: 1500 },
    { drag: [[0.88, 0.56], [0.86, 0.36], [0.62, 0.2]], duration: 1500, approach: 300, pause: 1300 },
  ],
});
