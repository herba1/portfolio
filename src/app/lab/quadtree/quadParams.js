export const SHAPES = { tiles: 0, discs: 1, outline: 2 };

export const QUAD_BASE = {
  shape: 0,
  restSplits: 560,
  areaPower: 0.25,
  minTile: 2,
  lens: 0.16,
  budget: 48,
  mergeDelay: 1.4,
  gap: 0.08,
  radius: 0.22,
};

export const QUAD_PRESETS = [
  { name: "Tiles", values: {} },
  { name: "Discs", values: { shape: SHAPES.discs, gap: 0.06 } },
  { name: "Outline", values: { shape: SHAPES.outline, gap: 0, radius: 0, restSplits: 900 } },
  { name: "Pixels", values: { gap: 0, radius: 0, restSplits: 420, areaPower: 0.32 } },
];

export const DEFAULT_PRESET = "Tiles";

export function presetValues(preset) {
  return { ...QUAD_BASE, ...preset.values };
}

export const QUAD_DEFAULTS = presetValues(QUAD_PRESETS[0]);

export const QUAD_GROUPS = [
  {
    name: "Tree",
    controls: [
      { key: "restSplits", label: "Resting splits", min: 60, max: 1800, step: 20 },
      { key: "areaPower", label: "Area power", min: 0, max: 0.5, step: 0.01 },
      { key: "minTile", label: "Smallest tile", min: 2, max: 16, step: 1, unit: "px" },
    ],
  },
  {
    name: "Lens",
    controls: [
      { key: "lens", label: "Radius", min: 0.08, max: 0.4, step: 0.01 },
      { key: "budget", label: "Splits per frame", min: 16, max: 160, step: 4 },
      { key: "mergeDelay", label: "Forget after", min: 0.4, max: 4, step: 0.1, unit: "s" },
    ],
  },
  {
    name: "Tile",
    controls: [
      { key: "gap", label: "Gap", min: 0, max: 0.16, step: 0.01 },
      { key: "radius", label: "Corner", min: 0, max: 0.4, step: 0.01 },
    ],
  },
];

export const FACES = [
  { id: "face-john", title: "John", artist: "Cast portrait", image: "/cast/john.webp" },
  { id: "face-paul", title: "Paul", artist: "Cast portrait", image: "/cast/paul.webp" },
  { id: "face-george", title: "George", artist: "Cast portrait", image: "/cast/george.webp" },
];
