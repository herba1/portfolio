// Hold Menu: long-press a cover, slide into Share, go two layers deep, send.
const cover = ".hm-cell:nth-child(2) .hm-cover";
const item = (label) => `.hm-item:has-text("${label}"):visible`;

// The second menu opens on a cover that is on screen in each layout.
const beats = (second) => [
  // One gesture: press and hold a cover, slide through Share and Messages
  // while still holding, release on a contact. Each layer stacks on the last.
  {
    hold: cover, press: 900, zoom: 1.2, follow: true,
    then: [item("Share"), item("Messages"), item("Maya Lin")], dragDuration: 750, between: 700,
    pause: 500,
  },
  { camera: "reset", pause: 1500 },   // pull back in time to catch the "Sent" toast
  // Then the same menu with taps: open, step into a submenu, choose.
  { hold: second, press: 700, pause: 600 },
  { click: item("Add to Playlist"), duration: 650, zoom: 1.15, pause: 1000 },
  { click: item("Late Night Drive"), duration: 650, pause: 1700 },
  { camera: "reset" },
];

const reel = {
  url: "/lab/hold-menu",
  stage: { sel: ".hm-cell", pad: 0.14 },  // the shelf of covers, centred,
  css: ".hm-head { visibility: hidden; }",
  ready: ".hm-cover img",
  intro: { hold: 1400, zoom: 1, fade: 0, trim: 1300 },
  outro: { hold: 700 },
  loop: { fade: 700 },
  cursor: { from: [0.74, 0.86], visible: true },
  formats: ["feed"],
  beats: beats(".hm-cell:nth-child(7) .hm-cover"),
  per: { vertical: { beats: beats(".hm-cell:nth-child(3) .hm-cover") }, feed: { beats: beats(".hm-cell:nth-child(3) .hm-cover") } },
};

export default reel;
