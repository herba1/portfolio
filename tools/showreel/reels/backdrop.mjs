import { piece } from "./_piece.mjs";
// A now-playing screen whose backdrop is painted from the cover and moves with the music. Press play.
export default piece({
  url: "/backdrop", ready: "[data-ready]",
  beats: [
    { click: 'button[aria-label="Play"]', duration: 900, pause: 5500 },
  ],
});
