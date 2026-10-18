export const SCENES = [
  {
    id: "dusk",
    label: "Dusk",
    note: "Sun going down behind the skyline",
    crop: [0, 0.04, 1, 0.96],
    focus: [0.6, 0.5],
    grade: [1.25, 1.12, -0.5, 1.06],
    fog: [0.3, 0.18, 0.18, 0.16],
    fogAmount: 0.88,
    tint: "linear-gradient(180deg, #1a1d3d 0%, #8a4a74 40%, #f39a62 70%, #160e1c 100%)",
  },
  {
    id: "blue",
    label: "Blue hour",
    note: "Windows coming on across midtown",
    crop: [0, 0.04, 1, 0.96],
    focus: [0.5, 0.62],
    grade: [1.2, 1.18, 0.1, 1.06],
    fog: [0.1, 0.12, 0.2, 0.16],
    fogAmount: 0.88,
    tint: "linear-gradient(180deg, #060a1e 0%, #1f3768 50%, #6f7fa8 70%, #070a16 100%)",
  },
  {
    id: "harbor",
    label: "Harbor",
    note: "Sunset over the water",
    crop: [0, 0.06, 1, 0.94],
    focus: [0.42, 0.5],
    grade: [1.25, 1.12, -0.5, 1.06],
    fog: [0.3, 0.16, 0.18, 0.16],
    fogAmount: 0.88,
    tint: "linear-gradient(180deg, #232048 0%, #b25c74 40%, #ffc27a 58%, #1c1228 100%)",
  },
];

export const RAIN_DEFAULT = 0.42;
