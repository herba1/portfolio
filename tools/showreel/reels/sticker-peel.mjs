// Sticker Peel: catch the lifted corner, peel the price sticker back over its
// fold until the glue lets go, carry it off and stick it down somewhere else.
const reel = {
  url: "/lab/sticker-peel",
  css: ".sticker-peel-head, .sticker-peel-live { visibility: hidden; }",
  stage: { rect: [0.3, 0.02, 0.56, 0.94] },   // the record and the air above it, not the empty desk
  ready: ".sticker-peel-stage[data-ready]",
  intro: { hold: 1400, zoom: 1.1 },
  cursor: { from: [0.86, 0.9] },
  formats: ["landscape"],
  beats: [
    // find the curl, lean in on it
    { move: [783, 252], duration: 1100, zoom: 1.6, zoomOn: [840, 220], pause: 350 },
    // peel it back across itself, past the far corner, until the glue lets go
    { drag: [[783, 252], [840, 215], [930, 160], [1010, 115], [1060, 95]], duration: 800, release: 400, follow: true, pause: 300 },
    { camera: "reset", pause: 200 },
    // it is free: carry it across the cover and stick it down
    { drag: [[1060, 95], [620, 470]], approach: 300, duration: 1400, pause: 1800 },
  ],
};

export default reel;
