import { piece } from "./_piece.mjs";
// A cover printed in dots. Click and the print bursts into the next cover.
export default piece({
  url: "/lab/amorph", ready: "canvas",
  hide: [".amorph__inks"],
  beats: [
    { click: [0.5, 0.48], duration: 800, settle: 200, pause: 3200 },
    { click: [0.44, 0.42], duration: 700, settle: 200, pause: 3200 },
  ],
});
