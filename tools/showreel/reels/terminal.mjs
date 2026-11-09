import { piece } from "./_piece.mjs";
// A 1983 green-screen record menu. Pick a record: its cover rasters in while the tracklist types out.
export default piece({
  url: "/lab/terminal", ready: "canvas, pre",
  beats: [
    { key: "ArrowUp", pause: 500 },
    { key: "ArrowUp", pause: 500 },
    { key: "Enter", pause: 4500 },
  ],
});
