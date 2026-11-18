import { piece } from "./_piece.mjs";
// "still here?" saved as a JPEG over and over. The clip opens deep in the
// decay (wound forward off camera), drags back to the clean copy, then
// drags forward into the mush again. Full bleed on the picture itself.
export default piece({
  url: "/lab/generation-loss", ready: "canvas, img",
  stage: { sel: "canvas", pad: 0 },
  hide: [".generation-loss-file"],
  // The paper fills the frame: page ground and card become one white sheet.
  css: `html, body, .generation-loss, [data-reel-stage] { background: #fff !important; }
    .generation-loss-card { border: 0 !important; box-shadow: none !important; outline: none !important; }`,
  intro: { hold: 1400, zoom: 1, fade: 0, trim: 3600 },
  beats: [
    { focus: ".generation-loss-card" },
    { key: "Shift+ArrowRight", times: 10, gap: 60, pause: 1600 },
    { drag: [[0.8, 0.42], [0.22, 0.44]], duration: 1200, approach: 500, pause: 900 },
    { drag: [[0.25, 0.43], [0.82, 0.42]], duration: 1300, approach: 300, pause: 1000 },
  ],
});
