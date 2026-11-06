// Kern: one huge word on springs.
//   1. the still word (its own load pluck and idle hints are off on camera)
//   2. tap a letter: the whole word morphs into the heavy, condensed cut
//   3. grab the g and stretch the line like a ribbon, hold, let go: it re-kerns
//   4. tap again: back to the light cut
//   5. flick the h up and down; it rings and settles
const letter = (i) => `.kern-stage text >> nth=${i}`;
const off = (i, x, y) => ({ sel: letter(i), at: [x, y] });

const reel = {
  url: "/lab/kern",
  css: ".kern-title { visibility: hidden; }",
  stage: { sel: ".kern-stage text", pad: 0.16 },  // room for the camera to lean toward the hand and for the stretch
  ready: ".kern[data-ready]",                   // after the font is in and the word is laid out, so the framing is measured on the real word
  // No idle motion on camera: Kern gates its load pluck, scatter-in and idle
  // attract (auto-plucks, auto-morphs) behind reduced motion, and keeps every
  // spring the hand drives. So the word sits still until the pointer touches it.
  reducedMotion: "reduce",
  intro: { hold: 1500, zoom: 1, fade: 0, trim: 1400 },  // skip the grow-in: open on the still word, hand at rest; the first tap lands by ~1.2s
  tempo: 1.2,
  outro: { hold: 500 },
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
