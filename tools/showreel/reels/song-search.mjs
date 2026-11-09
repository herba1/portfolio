import { piece } from "./_piece.mjs";
import { itunesMock } from "./_tracks.mjs";
// Search a song: its cover and colours load in.
export default piece({
  url: "/song-search", ready: "input",
  mock: [itunesMock],
  hide: [".ss-toggle"],
  beats: [
    { click: "input", duration: 900, pause: 300 },
    { type: "come", delay: 110, pause: 900 },
    { click: ".bd-dock__row >> nth=0", duration: 700, pause: 3200 },
  ],
});
