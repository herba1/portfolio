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
  // loop: open on the settled word with the hand at rest, so the clip can end on
  // exactly that frame. The word's own load pluck is the first motion (a quarter
  // second in), and the hand is in for the first tap by about 1.5s.
  intro: { hold: 1900, zoom: 1, fade: 0, trim: 1150 },
  tempo: 1.2,
  outro: { hold: 500 },                         // stop before the word's own idle pluck kicks in
  loop: true,                                   // ends on its own first frame: the light cut, the hand back where it began
  cursor: { from: [0.7, 0.86], visible: true },
  formats: ["feed", "landscape", "vertical"],
  beats: [
    { click: off(4, 0.8, 0.68), duration: 650, settle: 260, pause: 900 },  // land in the t's open corner (on paper, not ink, so the press shows), a beat, press: heavy
    { press: letter(8), duration: 600, settle: 80 },
    { move: off(8, 3.6, 0.35), duration: 650, arc: 0.04, pause: 250 },     // stretch
    { lift: true, pause: 900 },                                           // snap back, re-kern
    { click: off(1, 0.5, 0.6), duration: 650, settle: 260, pause: 800 },   // same tap inside the o's counter: light
    { press: letter(5), duration: 600, settle: 80 },
    { move: off(5, 0.5, -1.7), duration: 330, arc: 0, pause: 60 },
    { move: off(5, 0.5, 2.2), duration: 280, arc: 0 },
    { lift: true, pause: 900 },
    { move: [0.7, 0.86], duration: 900, pause: 300 },                    // home, for the loop
  ],
};

export default reel;
