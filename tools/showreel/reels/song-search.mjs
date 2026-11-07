import { piece } from "./_piece.mjs";
// Search a song and its cover and colours load in.
export default piece({
  url: "/song-search", ready: "input",
  hide: [".ss-toggle"],
  beats: [
    { click: "input", duration: 900, pause: 300 },
    { type: "come together", delay: 90, pause: 900 },
    { key: "Enter", pause: 3500 },
  ],
});
