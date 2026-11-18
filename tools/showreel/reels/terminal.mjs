import { piece } from "./_piece.mjs";
// A 1983 green-screen record menu: choose a record and its cover rasters in while the tracklist types out.
// Its two-column layout only exists on a landscape screen, so this one is 16:9.
export default piece({
  url: "/lab/terminal", ready: ".terminal-screen[data-ready]",
  formats: ["landscape"],
  hand: false,
  beats: [
    { focus: ".terminal-screen", pause: 300 },
    { key: "ArrowUp", pause: 450 },
    { key: "ArrowUp", pause: 450 },
    { key: "Enter", pause: 5000 },
  ],
});
