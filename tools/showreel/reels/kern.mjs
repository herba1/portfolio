// Kern: one huge word on springs.
//   1. it plucks itself on load
//   2. tap a letter: the whole word morphs into the heavy, condensed cut
//   3. grab the g and stretch the line like a ribbon, hold, let go: it re-kerns
//   4. tap again: back to the light cut
//   5. flick the h up and down; it rings and settles
const letter = (i) => `.kern-stage text >> nth=${i}`;
const off = (i, x, y) => ({ sel: letter(i), at: [x, y] });

const reel = {
  url: "/lab/kern",
  css: ".kern-title { visibility: hidden; }",
  stage: { sel: ".kern-stage text", pad: 0.06 },
  ready: ".kern-stage text",
  intro: { hold: 1900, zoom: 1.06 },
  cursor: { from: [0.78, 0.9] },
  formats: ["landscape", "vertical"],
  beats: [
    { click: letter(4), duration: 1100, settle: 220, pause: 1700 },          // heavy
    { press: letter(8), duration: 900, settle: 180 },
    { move: off(8, 3.6, 0.35), duration: 1000, arc: 0.04, pause: 700 },     // stretched, held
    { lift: true, pause: 1600 },                                            // snaps back, re-kerns
    { click: letter(1), duration: 1000, settle: 220, pause: 1700 },         // light again
    { press: letter(5), duration: 900, settle: 180 },
    { move: off(5, 0.5, -1.7), duration: 600, arc: 0, pause: 250 },
    { move: off(5, 0.5, 2.2), duration: 450, arc: 0 },
    { lift: true, pause: 1900 },
    { move: [0.8, 0.86], duration: 1100, pause: 600 },                      // step out of the way
  ],
};

export default reel;
