// Cover Flow: fling through the shelf, then flip the centre record to its back.
const centre = '.cf-item[aria-selected="true"]';
const prev = '.cf-step[aria-label="Previous record"]';
const next = '.cf-step[aria-label="Next record"]';

const reel = {
  url: "/lab/coverflow",
  stage: { sel: "[data-cf-stage]", pad: 0.1 },  // frame the shelf, not the page
  css: ".cf-heading { visibility: hidden; }",
  ready: ".cf-item[data-lit]",          // first sleeve has faded up
  intro: { hold: 1600, zoom: 1, fade: 0, trim: 1500 },
  outro: { hold: 700 },
  loop: { fade: 700 },
  cursor: { from: [0.74, 0.86], visible: true },
  formats: ["feed"],
  beats: [
    { drag: [[0.66, 0.42], [0.22, 0.44]], duration: 520, approach: 900, pause: 1500 },
    { click: prev, duration: 900, pause: 450 },
    { click: "cursor", pause: 900 },
    { move: centre, duration: 900, zoom: 1.45, pause: 300 },
    { click: "cursor", pause: 1500 },
    { move: { sel: `${centre} .cf-track`, at: [0.3, 0.5] }, duration: 800, pause: 200 },
    { click: "cursor", pause: 1400 },
    { camera: "reset" },
    { click: next, duration: 900, pause: 1500 },
  ],
  per: {
    feed: null, // filled below
    // Narrow layout: same story, one sleeve wide, so drag less and zoom less.
    vertical: {
      beats: [
        { drag: [[0.75, 0.42], [0.2, 0.43]], duration: 420, approach: 900, pause: 1500 },
        { move: centre, duration: 900, zoom: 1.25, pause: 300 },
        { click: "cursor", pause: 1500 },
        { move: { sel: `${centre} .cf-track`, at: [0.3, 0.5] }, duration: 800, pause: 200 },
        { click: "cursor", pause: 1400 },
        { camera: "reset" },
        { drag: [[0.25, 0.42], [0.8, 0.43]], duration: 380, approach: 800, pause: 1500 },
      ],
    },
  },
};

reel.per.feed = reel.per.vertical;
export default reel;
