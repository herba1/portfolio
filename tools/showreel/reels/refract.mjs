import { piece } from "./_piece.mjs";
// A gradient bent through a lattice of lenses: tap for the next plate, move to tilt it.
export default piece({
  url: "/refract", ready: "canvas[data-painted]",
  beats: [
    { move: [0.3, 0.35], duration: 700, pause: 200 },
    { move: [0.7, 0.62], duration: 900, arc: 0.2, pause: 200 },
    { click: "cursor", pause: 1600 },
    { move: [0.4, 0.45], duration: 700, arc: 0.2, pause: 100 },
    { click: "cursor", pause: 1800 },
  ],
});
