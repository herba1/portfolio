import { piece } from "./_piece.mjs";
// Lines of type made of steam. Blow through them and they swirl apart and pull back together.
export default piece({
  url: "/lab/steam", ready: "canvas",
  beats: [
    { move: [0.15, 0.5], duration: 600 },
    { move: [0.85, 0.48], duration: 1300, arc: 0.12, pause: 900 },
    { move: [0.3, 0.52], duration: 1100, arc: 0.12, pause: 1600 },
  ],
});
