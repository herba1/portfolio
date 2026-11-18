import { piece } from "./_piece.mjs";
// A film on a split-flap board: a flap only falls where its piece of the frame changes. With its clicks.
export default piece({
  url: "/lab/split-flap", ready: "[data-ready]",
  embed: false,                       // the clicks switch lives on the full page
  audio: true,
  stage: { sel: ".split-flap-board", pad: 0.04 },
  hide: [".split-flap-films"],
  hand: false,
  beats: [
    { run: ({ page }) => page.evaluate(() => document.querySelector(".split-flap-sound")?.click()), pause: 300 },
    { wait: 7000 },
  ],
});
