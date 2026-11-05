// Cover Flow: fling through the shelf, then flip the centre record to its back.
const centre = '.cf-item[aria-selected="true"]';

const reel = {
  url: "/lab/coverflow",
  title: "Cover Flow",
  ready: ".cf-item[data-lit]",          // first sleeve has faded up
  intro: { hold: 1600, zoom: 1.12 },     // open slightly close, settle out while the sleeves fade up
  cursor: { from: [0.78, 0.86] },
  formats: ["landscape", "vertical"],
  beats: [
    { caption: "Drag to fling", duration: 2200 },
    { drag: [[0.66, 0.42], [0.22, 0.44]], duration: 520, approach: 900, pause: 1500 },
    { key: "ArrowLeft", times: 2, gap: 520, pause: 900 },
    { move: centre, duration: 900, zoom: 1.45, pause: 300 },
    { click: "cursor", pause: 1500 },
    { move: { sel: `${centre} .cf-track`, at: [0.3, 0.5] }, duration: 800, pause: 200 },
    { click: "cursor", pause: 1400 },
    { camera: "reset" },
    { key: "ArrowRight", pause: 1500 },
  ],
  per: {
    // Narrow layout: same story, one sleeve wide, so drag less and zoom less.
    vertical: {
      beats: [
        { caption: "Swipe to fling", duration: 2200 },
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

export default reel;
