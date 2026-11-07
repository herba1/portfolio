import { piece } from "./_piece.mjs";
// A now-playing screen whose backdrop is painted from the cover. Skip and it repaints.
export default piece({
  url: "/backdrop", ready: "[data-ready]",
  beats: [
    { click: [0.59, 0.83], duration: 900, settle: 200, pause: 2600 },
    { click: "cursor", pause: 2600 },
  ],
});
