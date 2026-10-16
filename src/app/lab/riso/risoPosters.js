export const SHEET_MM = 297;
export const ASPECT = Math.SQRT2;
export const TEX_W = 1200;
export const TEX_H = Math.round(TEX_W * ASPECT);

export const MARKS = [
  [46, 46],
  [TEX_W - 46, 46],
  [46, TEX_H - 46],
  [TEX_W - 46, TEX_H - 46],
];

export const POSTERS = [
  {
    key: "swimmers",
    label: "Night Swimmers",
    short: "Swimmers",
    src: "/monovolt/abt1.webp",
    focus: 0.42,
    seed: 3.1,
    inks: [
      { name: "Fluoro Pink", rgb: [255, 72, 176] },
      { name: "Medium Blue", rgb: [50, 85, 164] },
    ],
    screens: [
      { mode: "grain", angle: 0 },
      { mode: "dot", angle: 45 },
    ],
    curves: [
      [0.04, 0.6, 0.92],
      [0.3, 0.92, 0.96],
    ],
    rest: [
      [1.5, -0.9],
      [-0.6, 0.7],
    ],
    kicker: "Monovolt presents",
    issue: "No. 14",
    name: ["night", "swimmers"],
    rows: [
      ["The Glasshouse", "41 Wharf Road, Leith"],
      ["Fri 14 Nov", "Doors 22:00 till late"],
      ["£12 adv", "£15 on the door"],
    ],
    support: ["with", "Sela Marr and Odd Hours"],
  },
  {
    key: "halogen",
    label: "Halogen",
    short: "Halogen",
    src: "/monovolt/abt10.webp",
    focus: 0.5,
    seed: 11.7,
    inks: [
      { name: "Yellow", rgb: [255, 226, 0] },
      { name: "Teal", rgb: [0, 131, 138] },
    ],
    screens: [
      { mode: "dot", angle: 15 },
      { mode: "dot", angle: 75 },
    ],
    lightFromHighlights: true,
    curves: [
      [0.12, 0.62, 0.96],
      [0.4, 0.97, 0.98],
    ],
    rest: [
      [-1.3, -1.1],
      [0.5, 0.6],
    ],
    kicker: "Tunnel Sessions",
    issue: "Vol. 3",
    name: ["halogen", "all night"],
    rows: [
      ["Arch 9", "Under the viaduct, SE1"],
      ["Sat 29 Nov", "23:00 till 06:00"],
      ["£18", "Residents from 23:00"],
    ],
    support: ["with", "Pell Grove, Isa Vane, Kito"],
  },
  {
    key: "lowtide",
    label: "Low Tide Static",
    short: "Low Tide",
    src: "/monovolt/abt7.webp",
    focus: 0.36,
    seed: 23.4,
    inks: [
      { name: "Fluoro Orange", rgb: [255, 116, 119] },
      { name: "Purple", rgb: [118, 91, 167] },
    ],
    screens: [
      { mode: "grain", angle: 0 },
      { mode: "grain", angle: 0 },
    ],
    curves: [
      [0.03, 0.56, 0.94],
      [0.28, 0.9, 0.97],
    ],
    rest: [
      [1.1, 1.2],
      [-0.7, -0.5],
    ],
    kicker: "Back room, every Thursday",
    issue: "B2B",
    name: ["low tide", "static"],
    rows: [
      ["The Cellar Bar", "Basement, 12 Mill Lane"],
      ["Thu 4 Dec", "21:00 till 03:00"],
      ["Free entry", "Before midnight"],
    ],
    support: ["records by", "Juno Fair b2b Arlo Penn"],
  },
];
