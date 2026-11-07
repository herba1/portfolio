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
  intro: { hold: 900, zoom: 1, fade: 0, trim: 820 },   // loop: open on the settled record, hand at rest; the reach starts at once
  tempo: 1.2,
  outro: { hold: 1400 },
  // The sticker can't be put back exactly, so at the end the page alone dissolves
  // to frame one: the sticker fades off the cover and back onto its corner while
  // the sleeve, record, camera and pointer land on frame one exactly.
  loop: { fade: 1000 },
  cursor: { from: [0.78, 0.62], visible: true },
  formats: ["feed"],
  beats: [
    { move: [798, 262], duration: 650, zoom: 1.45, zoomOn: [880, 225], pause: 250 },
    { press: "cursor", settle: 80 },
    { move: [880, 236], duration: 650, arc: 0.04, pause: 300 },            // glue strands
    { move: [1090, 190], duration: 700, arc: 0.04, pause: 200 },           // lets go
    { camera: { zoom: 1.2, on: "cursor", follow: true } },
    { move: [640, 470], duration: 1000, arc: 0.14, pause: 150 },            // carry it over the cover
    { lift: true, pause: 300 },
    { camera: "reset" },
    { move: [0.78, 0.62], duration: 900, pause: 400 },                      // hand home, for the loop
  ],
};

// The 4:5 layout stacks the record lower and narrower; same story in viewport fractions.
reel.per = {
  feed: {
    stage: { rect: [0.06, 0.22, 0.88, 0.62] },
    beats: [
      { move: [0.53, 0.46], duration: 650, zoom: 1.4, zoomOn: [0.62, 0.4], pause: 250 },
      { press: "cursor", settle: 80 },
      { move: [0.62, 0.43], duration: 650, arc: 0.04, pause: 300 },
      { move: [0.86, 0.3], duration: 700, arc: 0.04, pause: 200 },
      { camera: { zoom: 1.15, on: "cursor", follow: true } },
      { move: [0.42, 0.66], duration: 1000, arc: 0.14, pause: 150 },
      { lift: true, pause: 300 },
      { camera: "reset" },
      { move: [0.74, 0.86], duration: 900, pause: 400 },
    ],
  },
};
export default reel;
