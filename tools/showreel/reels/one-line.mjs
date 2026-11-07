import { piece } from "./_piece.mjs";
// A tab bar drawn by a single thread. Tap a tab and the line runs over to it.
export default piece({
  url: "/one-line", ready: ".ol-bar",
  stage: { sel: ".ol-stage", pad: 0.1 },
  beats: [
    { click: '.ol-tab:has-text("Library")', duration: 800, pause: 1100 },
    { click: '.ol-tab:has-text("Profile")', duration: 700, pause: 1100 },
    { click: '.ol-tab:has-text("Home")', duration: 900, pause: 1100 },
    { click: '.ol-tab:has-text("Search")', duration: 700, pause: 1200 },
  ],
});
