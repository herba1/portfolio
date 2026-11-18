import { piece } from "./_piece.mjs";
// A search dock over Apple's catalogue: open it, type, and pick a song.
export default piece({
  url: "/song-search", ready: "input",
  embed: false,
  hide: [".ss-toggle"],
  beats: [
    { click: "input", duration: 700, pause: 500 },
    { type: "come together", delay: 160, pause: 1100 },
    { click: ".bd-dock__row >> nth=0", duration: 600, pause: 3200 },
  ],
});
