// Sticker Peel, as a hand would do it:
//   1. hover the lifted corner; it lifts a touch more
//   2. press and peel slowly along the sticker, stopping halfway so the glue strands show
//   3. keep going until it lets go of the sleeve
//   4. carry it across the cover and lay it down; the old spot keeps its residue
const reel = {
  url: "/lab/sticker-peel",
  css: ".sticker-peel-head, .sticker-peel-live { visibility: hidden; }",
  stage: { rect: [0.3, 0.02, 0.56, 0.94] },   // the record and the air above it, not the empty desk
  ready: ".sticker-peel-stage[data-ready]",
  intro: { hold: 1400, zoom: 1.1 },
  cursor: { from: [0.86, 0.9] },
  tempo: 1.4,                          // unhurried: every move and hold 40% slower
  formats: ["landscape"],
  beats: [
    { move: [798, 262], duration: 1200, zoom: 1.45, zoomOn: [880, 225], pause: 700 },
    { press: "cursor", settle: 150 },
    { move: [880, 236], duration: 1000, arc: 0.04, pause: 650 },           // halfway: strands
    { move: [1010, 206], duration: 1000, arc: 0.04, pause: 150 },
    { move: [1090, 190], duration: 650, arc: 0.03, pause: 500 },           // free
    { camera: { zoom: 1.2, on: "cursor", follow: true } },
    { move: [640, 470], duration: 1500, arc: 0.14, pause: 350 },            // carry it over
    { lift: true, pause: 300 },
    { camera: "reset", pause: 1700 },
    { move: [0.84, 0.86], duration: 1100, pause: 500 },
  ],
};

export default reel;
