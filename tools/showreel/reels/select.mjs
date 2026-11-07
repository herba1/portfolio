import { piece } from "./_piece.mjs";
// An iPhone text selection. Drag a handle and the page tips back in perspective; let go, then Copy.
export default piece({
  url: "/lab/select", ready: ".select-handle-knob",
  beats: [
    { press: ".select-handle-knob >> nth=-1", duration: 800, settle: 150 },
    { move: { sel: ".select-handle-knob >> nth=-1", at: [8, 5] }, duration: 1400, arc: 0.06, pause: 500 },
    { lift: true, pause: 1300 },
    { click: ':text-is("Copy"):visible', duration: 700, pause: 1600 },
  ],
});
