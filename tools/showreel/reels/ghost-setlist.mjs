import { piece } from "./_piece.mjs";
// A setlist in lit lettering on an arc. Flick it and every title swings round leaving cooling afterimages.
export default piece({
  url: "/lab/ghost-setlist", ready: "canvas",
  beats: [
    { drag: [[0.72, 0.5], [0.28, 0.5]], duration: 450, approach: 800, pause: 1500 },
    { drag: [[0.72, 0.5], [0.3, 0.5]], duration: 450, approach: 600, pause: 1500 },
    { drag: [[0.3, 0.5], [0.72, 0.5]], duration: 500, approach: 600, pause: 1500 },
  ],
});
