import { piece } from "./_piece.mjs";
// Six covers in dots of ink; click and the print bursts into the next cover.
export default piece({
  url: "/lab/amorph", ready: '.amorph[data-phase="ready"]',
  beats: [
    { click: [0.5, 0.48], duration: 650, settle: 120, pause: 2600 },
    { click: [0.42, 0.4], duration: 600, settle: 120, pause: 1200 },
    { click: [0.6, 0.58], duration: 500, settle: 80, pause: 2600 },
  ],
});
