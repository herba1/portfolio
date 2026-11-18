import { piece } from "./_piece.mjs";
// Apple Music's now-playing backdrop rebuilt: press play and the artwork swirls behind the track.
export default piece({
  url: "/backdrop", ready: "[data-ready]",
  beats: [
    { wait: 1500 },
    { click: 'button[aria-label="Play"]', duration: 700, pause: 6000 },
  ],
});
