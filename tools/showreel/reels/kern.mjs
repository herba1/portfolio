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
  intro: { hold: 1100, zoom: 1.06 },
  outro: { hold: 1300 },
  cursor: { from: [0.78, 0.9] },
  formats: ["landscape", "vertical"],
  beats: [
    { click: letter(4), duration: 700, settle: 100, pause: 900 },          // heavy
    { press: letter(8), duration: 600, settle: 80 },
    { move: off(8, 3.6, 0.35), duration: 650, arc: 0.04, pause: 250 },     // stretch
    { lift: true, pause: 900 },                                           // snap back, re-kern
    { click: letter(1), duration: 650, settle: 100, pause: 800 },         // light
    { press: letter(5), duration: 600, settle: 80 },
    { move: off(5, 0.5, -1.7), duration: 330, arc: 0, pause: 60 },
    { move: off(5, 0.5, 2.2), duration: 280, arc: 0 },
    { lift: true, pause: 1200 },
  ],
};

export default reel;
