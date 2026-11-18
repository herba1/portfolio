import { piece } from "./_piece.mjs";
// A phone LCD writing a text the old way: keys cycle, T9 guesses, then Sending, Sent. With its sound.
export default piece({
  url: "/lab/t9", ready: ".t9-screen[data-ready]",
  embed: false,                       // the sound switch lives on the full page
  audio: true,
  stage: { sel: ".t9-screen", pad: 0.05 },
  hand: false,
  beats: [
    { run: ({ page }) => page.evaluate(() => document.querySelector(".t9-sound")?.click()), pause: 300 },
    { focus: ".t9-screen", pause: 200 },
    { type: "have a nice day", delay: 260, pause: 600 },
    { key: "Enter", pause: 3000 },   // send it: Sending, then Sent
  ],
});
