import { piece } from "./_piece.mjs";
// A card-collecting app. Save a card and it flies into the Collection tab.
export default piece({
  url: "/flyout", ready: ".flyout-tab",
  beats: [
    { click: [0.46, 0.16], duration: 900, settle: 150, pause: 1600 },
    { click: [0.78, 0.16], duration: 700, settle: 150, pause: 1600 },
  ],
});
