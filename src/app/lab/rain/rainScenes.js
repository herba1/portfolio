export const SCENES = [
  {
    id: "valley",
    label: "Valley",
    note: "Alpine valley, overcast",
    src: "/scorch/valley.webp",
    crop: [0.035, 0.02, 0.93, 0.9],
    focus: [0.5, 0.42],
    grade: [0.88, 1.04, 0.45, 1.05],
    fog: [0.17, 0.19, 0.21, 0.3],
    fogAmount: 1,
  },
  {
    id: "meadow",
    label: "Meadow",
    note: "Wildflowers after a shower",
    src: "/scorch/meadow.webp",
    crop: [0, 0, 0.94, 0.93],
    focus: [0.5, 0.6],
    grade: [0.94, 0.9, 0.2, 1.08],
    fog: [0.12, 0.14, 0.12, 0.2],
    fogAmount: 0.96,
  },
  {
    id: "night",
    label: "Night",
    note: "Headlights in the fog",
    src: "/scorch/beams.webp",
    crop: [0, 0, 1, 1],
    focus: [0.2, 0.62],
    grade: [0.96, 0.96, 0.15, 1.06],
    fog: [0.08, 0.07, 0.08, 0.2],
    fogAmount: 0.92,
  },
];

export const RAIN_DEFAULT = 0.42;
