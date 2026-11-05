// Hold Menu: long-press a cover, slide into Share, go two layers deep, send.
const cover = ".hm-cell:nth-child(2) .hm-cover";
const item = (label) => `.hm-item:has-text("${label}"):visible`;

// The second menu opens on a cover that is on screen in each layout.
const beats = (second) => [
  { caption: "Hold, slide, let go", duration: 2400 },
  // One gesture: press and hold a cover, slide through Share and Messages
  // while still holding, release on a contact. Each layer stacks on the last.
  {
    hold: cover, press: 900, zoom: 1.35, follow: true,
    then: [item("Share"), item("Messages"), item("Maya Lin")], dragDuration: 750, between: 700,
    pause: 500,
  },
  { camera: "reset", pause: 1500 },   // pull back in time to catch the "Sent" toast
  // Then the same menu with taps: open, step into a submenu, choose.
  { hold: second, press: 700, pause: 600 },
  { click: item("Add to Playlist"), duration: 650, zoom: 1.3, pause: 1000 },
  { click: item("Late Night Drive"), duration: 650, pause: 1700 },
  { camera: "reset" },
];

const reel = {
  url: "/lab/hold-menu",
  title: "Hold Menu",
  ready: ".hm-cover img",
  intro: { hold: 1400, zoom: 1.1 },
  cursor: { from: [0.8, 0.9] },
  formats: ["landscape", "vertical"],
  beats: beats(".hm-cell:nth-child(7) .hm-cover"),
  per: { vertical: { beats: beats(".hm-cell:nth-child(3) .hm-cover") } },
};

export default reel;
