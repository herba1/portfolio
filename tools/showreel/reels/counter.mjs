import { piece } from "./_piece.mjs";
// Song titles with the next record inside the o: tap and fall through the letter.
export default piece({
  url: "/counter", ready: "[data-ready]",
  beats: [
    { click: [0.5, 0.5], duration: 650, settle: 150, pause: 2600 },
    { click: [0.5, 0.5], duration: 400, settle: 100, pause: 2600 },
  ],
});
