import { piece } from "./_piece.mjs";
// "still here?" saved as a JPEG over and over. The clip opens deep in the
// decay (wound forward off camera), drags back to the clean copy, then
// drags forward into the mush again. Full bleed on the picture itself.
export default piece({
  url: "/lab/generation-loss", ready: "canvas, img",
  stage: { sel: "canvas", pad: 0, cover: true },
  css: ".generation-loss-card:focus, .generation-loss-card:focus-visible { outline: none !important; }",
  intro: { hold: 1400, zoom: 1, fade: 0, trim: 3600 },
  beats: [
    { focus: ".generation-loss-card" },
    { key: "Shift+ArrowRight", times: 6, gap: 80, pause: 1600 },
    { drag: [[0.8, 0.42], [0.22, 0.44]], duration: 1200, approach: 500, pause: 900 },
    { drag: [[0.25, 0.43], [0.82, 0.42]], duration: 1300, approach: 300, pause: 1000 },
  ],
});
