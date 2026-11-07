import { piece } from "./_piece.mjs";
// An XY oscilloscope draws whatever you type with its beam.
export default piece({
  url: "/lab/scope", ready: "canvas",
  beats: [
    { wait: 600 },
    { type: "yeah", delay: 220 },
    { key: "Enter", pause: 3000 },
  ],
});
