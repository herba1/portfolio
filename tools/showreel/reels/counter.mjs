import { piece } from "./_piece.mjs";
// Song titles with the next record waiting in the o. Tap and you fall through the letter.
export default piece({
  url: "/counter", ready: ".counter-stage[data-ready]",
  beats: [
    { click: [0.5, 0.5], duration: 800, settle: 200, pause: 2800 },
    { click: "cursor", pause: 2800 },
  ],
});
