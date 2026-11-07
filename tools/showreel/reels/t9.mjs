import { piece } from "./_piece.mjs";
// A phone LCD typing 2am texts the old way: letters cycle on the keys, T9 guesses, Sending, Sent.
export default piece({
  url: "/lab/t9", ready: "canvas, [class*=lcd]",
  beats: [{ wait: 7000 }],
});
