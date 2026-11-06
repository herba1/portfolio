// Kern: one huge word on springs. Pull letters out of line and let them snap back.
const letter = (i) => `.kern-stage text >> nth=${i}`;

const reel = {
  url: "/lab/kern",
  css: ".kern-title { visibility: hidden; }",
  stage: { sel: ".kern-stage text", pad: 0.06 },
  ready: ".kern-stage text",
  intro: { hold: 1800, zoom: 1.06 },   // it plucks itself on load
  cursor: { from: [0.8, 0.88] },
  formats: ["landscape", "vertical"],
  beats: [
    // pull each letter well out of line, hold it there so the springs show, let go
    { drag: [letter(5), { sel: letter(5), at: [0.5, -2.2] }], duration: 900, approach: 1000, release: 450, pause: 1500 },
    { drag: [letter(8), { sel: letter(8), at: [4.5, 0.2] }], duration: 1000, approach: 900, release: 450, pause: 1600 },
    { drag: [letter(2), { sel: letter(2), at: [-0.3, 3.2] }], duration: 900, approach: 900, release: 450, pause: 1800 },
  ],
};

export default reel;
