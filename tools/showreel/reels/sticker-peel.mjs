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
  intro: { hold: 500, zoom: 1, fade: 350 },   // feed first: the piece is there at once and the hand is in within a second
  tempo: 1.2,
  outro: { hold: 2000, fade: 900 },
  cursor: { from: [0.86, 0.9] },
  formats: ["landscape"],
  beats: [
    { move: [798, 262], duration: 750, zoom: 1.45, zoomOn: [880, 225], pause: 250 },
    { press: "cursor", settle: 80 },
    { move: [880, 236], duration: 650, arc: 0.04, pause: 300 },            // glue strands
    { move: [1090, 190], duration: 700, arc: 0.04, pause: 200 },           // lets go
    { camera: { zoom: 1.2, on: "cursor", follow: true } },
    { move: [640, 470], duration: 1000, arc: 0.14, pause: 150 },            // carry it over
    { lift: true, pause: 150 },
    { camera: "reset", pause: 1200 },
  ],
};

export default reel;
