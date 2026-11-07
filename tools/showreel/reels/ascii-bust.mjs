import { piece } from "./_piece.mjs";
// A marble bust typed in Geist Mono. Drag to turn it and the type re-sets to follow the form.
export default piece({
  url: "/lab/ascii-bust", ready: "canvas, pre",
  beats: [
    { drag: [[0.3, 0.5], [0.72, 0.5]], duration: 1500, approach: 700, pause: 900 },
    { drag: [[0.7, 0.5], [0.4, 0.5]], duration: 1200, approach: 400, pause: 1200 },
  ],
});
