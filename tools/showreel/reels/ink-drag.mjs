import { piece } from "./_piece.mjs";
// A record printed in wet ink: smear it, then watch the cover's ink flow into its title.
export default piece({
  url: "/lab/ink-drag", ready: "[data-ready]",
  hide: [".ink-drag__records", ".ink-drag__inks", ".ink-drag__fresh", "button"],
  beats: [
    { drag: [[0.3, 0.3], [0.5, 0.45], [0.72, 0.38], [0.62, 0.6]], duration: 900, approach: 600, pause: 400 },
    { move: [0.84, 0.88], duration: 600, pause: 7000 },   // out of the way for the morph into the words
  ],
});
