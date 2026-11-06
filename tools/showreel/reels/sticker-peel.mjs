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
  loop: true,
  cursor: { from: [0.78, 0.62], visible: true },
  formats: ["landscape"],
  beats: [
    { move: [798, 262], duration: 650, zoom: 1.45, zoomOn: [880, 225], pause: 250 },
    { press: "cursor", settle: 80 },
    { move: [880, 236], duration: 650, arc: 0.04, pause: 300 },            // glue strands
    { move: [1090, 190], duration: 700, arc: 0.04, pause: 200 },           // lets go
    { camera: { zoom: 1.2, on: "cursor", follow: true } },
    { move: [640, 470], duration: 1000, arc: 0.14, pause: 250 },            // carry it over the cover
    { move: [853, 232], duration: 1000, arc: 0.14, pause: 150 },            // and back onto its own spot
    { lift: true, pause: 300 },
    { camera: "reset" },
    // The piece's own fresh-sleeve key, sent straight to the canvas so it never
    // takes focus (no ring): the corner lifts again, exactly as on frame one.
    { run: ({ page }) => page.$eval(".sticker-peel-canvas", (c) => c.dispatchEvent(new KeyboardEvent("keydown", { key: "r", bubbles: true }))) },
    { move: [0.78, 0.62], duration: 900, pause: 400 },                      // hand home, for the loop
  ],
};

export default reel;
