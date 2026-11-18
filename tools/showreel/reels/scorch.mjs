import { piece } from "./_piece.mjs";
// A photo print hanging from its top edge: press and drag the flame and it
// burns, then the next print slides in and goes up too.
export default piece({
  url: "/scorch", ready: "[data-ready]",
  hide: ['[class*="ring"]', '[class*="controls"]'],
  globals: { __scorch: { burnRate: 2.2, heatSpread: 1.4 } },
  beats: [
    { key: "ArrowRight", pause: 900 },
    { drag: [[0.3, 0.75], [0.5, 0.62], [0.7, 0.7], [0.55, 0.45], [0.35, 0.5]], duration: 1100, approach: 450, pause: 2600 },
    { key: "ArrowRight", pause: 900 },
    { drag: [[0.65, 0.7], [0.45, 0.55], [0.3, 0.68]], duration: 800, approach: 400, pause: 2400 },
  ],
});
