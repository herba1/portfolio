// Kern: one huge word on springs, kept mostly in its thin cut.
//   1. the still word (its own load pluck and idle hints are off on camera)
//   2. grab the g and stretch the line like a ribbon, let go: it re-kerns
//   3. flick the h up and down; it rings and settles
//   4. tap: a quick blink of the heavy cut, tap: back to thin
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
  tempo: 1.1,
  outro: { hold: 500 },
  loop: true,                                   // ends on its own first frame: the light cut, the hand back where it began
  cursor: { from: [0.7, 0.86], visible: true },
  formats: ["feed"],                            // one clip per piece: 4:5, the feed format for X and LinkedIn
  beats: [
    // Mostly the thin cut, which is the prettier one. Lead with the stretch so
    // the springs read within a second, then the flick, then a quick blink of
    // the heavy cut and straight back.
    { press: letter(8), duration: 650, settle: 120 },
    { move: off(8, 3.6, 0.35), duration: 600, arc: 0.04, pause: 220 },     // stretch the line
    { lift: true, pause: 750 },                                           // snap back, re-kern
    { press: letter(5), duration: 600, settle: 100 },
    { move: off(5, 0.5, -1.7), duration: 300, arc: 0, pause: 50 },
    { move: off(5, 0.5, 2.2), duration: 260, arc: 0 },
    { lift: true, pause: 750 },                                           // it rings and settles
    { click: off(4, 0.8, 0.68), duration: 550, settle: 220, pause: 650 },  // tap: heavy, briefly
    { click: off(1, 0.5, 0.6), duration: 550, settle: 220, pause: 650 },   // tap: back to thin
    { move: [0.7, 0.86], duration: 850, pause: 250 },                    // home, for the loop
  ],
};

export default reel;
