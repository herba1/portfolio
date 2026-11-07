import { piece } from "./_piece.mjs";
// A film on a split-flap board: a flap only falls where its piece of the frame changes.
export default piece({
  url: "/lab/split-flap", ready: "[data-ready]",
  stage: { sel: ".split-flap-board", pad: 0.08 },
  hide: [".split-flap-films"],
  beats: [{ move: [0.68, 0.8], duration: 1500, pause: 5500 }],
});
