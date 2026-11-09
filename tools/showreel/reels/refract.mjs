import { piece } from "./_piece.mjs";
// An image engine. Tap to reroll it.
export default piece({
  url: "/refract", ready: "canvas[data-painted]",
  hide: ['[class*="panel"]'],
  beats: [
    { click: [0.5, 0.5], duration: 800, settle: 200, pause: 2400 },
    { click: [0.44, 0.44], duration: 700, settle: 200, pause: 2400 },
  ],
});
