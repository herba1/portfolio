import { piece } from "./_piece.mjs";
// A film print on the table. Each press crushes it one step further, creasing like paper.
export default piece({
  url: "/lab/crumple", ready: "canvas[data-engine], canvas",
  beats: [
    { click: [0.55, 0.48], duration: 800, settle: 200, pause: 1500 },
    { click: "cursor", pause: 1500 },
    { click: "cursor", pause: 1500 },
    { click: "cursor", pause: 1800 },
  ],
});
