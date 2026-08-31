export const DEFAULT_IMAGE = "/cast/john.webp";

const PLATE_BASE = {
  fill: 0,
  zoom: 0.585,
  offsetX: 0,
  offsetY: 0,

  brightness: 0.02,
  contrast: 1.5,
  gamma: 1.05,
  invert: 0,

  angle: 0,
  lineCount: 62,
  weight: 0.98,
  bleed: 0.055,

  waver: 0.32,
  waverScale: 3.4,
  ragged: 0.16,
  raggedScale: 46,
  breakup: 0.55,
  breakScale: 16,
  dry: 0.42,
  dryScale: 620,

  pressure: 0.3,
  pressureScale: 2.6,
  fibre: 0.13,
  fibreScale: 210,
  tooth: 0.06,
  paperGrain: 0.045,
  halo: 0.55,
  haloBlur: 4.5,
  sheen: 0.22,

  paper: "#f7f5f0",
  ink: "#0c0c11",

  seed: 1.7,
  supersample: 1,
};

export const INK_PRESETS = [
  {
    name: "Negative",
    values: {
      invert: 1,
      contrast: 2.0,
      gamma: 1.0,
      lineCount: 76,
      weight: 1.05,
      breakup: 0.45,
      paper: "#111114",
      ink: "#f6f4ef",
      halo: 0.3,
      sheen: 0.0,
      paperGrain: 0.07,
    },
  },
  { name: "Stamp", values: {} },
  {
    name: "Woodcut",
    values: {
      lineCount: 34,
      weight: 1.12,
      bleed: 0.03,
      waver: 0.42,
      waverScale: 2.1,
      ragged: 0.5,
      raggedScale: 45,
      breakup: 0.4,
      dry: 0.18,
      contrast: 2.3,
      angle: 0,
      pressure: 0.45,
      halo: 0.35,
      sheen: 0.12,
    },
  },
  {
    name: "Fax",
    values: {
      lineCount: 168,
      weight: 0.92,
      bleed: 0.012,
      waver: 0.06,
      ragged: 0.12,
      raggedScale: 260,
      breakup: 0.85,
      breakScale: 62,
      dry: 0.5,
      dryScale: 900,
      contrast: 2.1,
      gamma: 1.0,
      pressure: 0.14,
      fibre: 0.08,
      halo: 0.15,
      sheen: 0.3,
      paper: "#f4f2ee",
    },
  },
  {
    name: "Charcoal",
    values: {
      lineCount: 46,
      weight: 1.25,
      bleed: 0.19,
      waver: 0.55,
      waverScale: 5.2,
      ragged: 0.62,
      raggedScale: 70,
      breakup: 0.5,
      dry: 0.62,
      dryScale: 340,
      contrast: 1.4,
      gamma: 1.4,
      pressure: 0.55,
      pressureScale: 1.6,
      fibre: 0.3,
      tooth: 0.14,
      paperGrain: 0.08,
      halo: 1.1,
      haloBlur: 5.5,
      sheen: 0.05,
      paper: "#f2efe7",
      ink: "#15140f",
    },
  },
];

export function presetValues(preset) {
  return { ...PLATE_BASE, ...preset.values };
}

export const DEFAULT_PRESET = "Negative";

export const INK_DEFAULTS = presetValues(
  INK_PRESETS.find((preset) => preset.name === DEFAULT_PRESET),
);

export const INK_GROUPS = [
  {
    name: "Frame",
    controls: [
      { key: "fill", label: "Fill frame", type: "toggle" },
      { key: "zoom", label: "Zoom", min: 0.25, max: 3, step: 0.005 },
      { key: "offsetX", label: "Pan across", min: -0.6, max: 0.6, step: 0.002 },
      { key: "offsetY", label: "Pan up", min: -0.6, max: 0.6, step: 0.002 },
      { key: "angle", label: "Stroke angle", min: -90, max: 90, step: 0.5, unit: "°" },
    ],
  },
  {
    name: "Tone",
    controls: [
      { key: "brightness", label: "Brightness", min: -0.5, max: 0.5, step: 0.005 },
      { key: "contrast", label: "Contrast", min: 0.2, max: 5, step: 0.01 },
      { key: "gamma", label: "Gamma", min: 0.25, max: 3, step: 0.01 },
      { key: "invert", label: "Invert source", type: "toggle" },
    ],
  },
  {
    name: "Strokes",
    controls: [
      { key: "lineCount", label: "Lines", min: 8, max: 260, step: 1 },
      { key: "weight", label: "Weight", min: 0.1, max: 1.6, step: 0.005 },
      { key: "bleed", label: "Bleed", min: 0, max: 0.5, step: 0.002 },
    ],
  },
  {
    name: "Hand",
    controls: [
      { key: "waver", label: "Waver", min: 0, max: 1.5, step: 0.005 },
      { key: "waverScale", label: "Waver scale", min: 0.3, max: 20, step: 0.05 },
      { key: "ragged", label: "Ragged edge", min: 0, max: 1.2, step: 0.005 },
      { key: "raggedScale", label: "Ragged scale", min: 5, max: 400, step: 1 },
      { key: "breakup", label: "Break into dashes", min: 0, max: 1.5, step: 0.005 },
      { key: "breakScale", label: "Dash scale", min: 1, max: 120, step: 0.5 },
      { key: "dry", label: "Dry brush", min: 0, max: 1, step: 0.005 },
      { key: "dryScale", label: "Dry brush scale", min: 40, max: 1600, step: 5 },
    ],
  },
  {
    name: "Press",
    controls: [
      { key: "pressure", label: "Uneven pressure", min: 0, max: 1.2, step: 0.005 },
      { key: "pressureScale", label: "Pressure scale", min: 0.3, max: 14, step: 0.05 },
      { key: "halo", label: "Ink soak", min: 0, max: 2, step: 0.01 },
      { key: "haloBlur", label: "Soak spread", min: 0, max: 8, step: 0.05 },
      { key: "sheen", label: "Edge sheen", min: 0, max: 2, step: 0.01 },
    ],
  },
  {
    name: "Paper",
    controls: [
      { key: "fibre", label: "Fibre bite", min: 0, max: 0.8, step: 0.005 },
      { key: "fibreScale", label: "Fibre scale", min: 20, max: 900, step: 2 },
      { key: "tooth", label: "Tooth shading", min: 0, max: 0.4, step: 0.002 },
      { key: "paperGrain", label: "Grain", min: 0, max: 0.3, step: 0.002 },
      { key: "paper", label: "Paper", type: "color" },
      { key: "ink", label: "Ink", type: "color" },
    ],
  },
  {
    name: "Plate",
    controls: [
      { key: "seed", label: "Seed", min: 0, max: 40, step: 0.01 },
      { key: "supersample", label: "Supersample", type: "toggle" },
    ],
  },
];

const REROLLABLE = INK_GROUPS.flatMap((group) =>
  group.controls.filter((control) => !control.type && group.name !== "Frame"),
);

export function rerollValues(current) {
  const next = { ...current, seed: Math.random() * 40 };
  for (const control of REROLLABLE) {
    if (control.key === "seed") continue;
    const spread = (control.max - control.min) * 0.16;
    const drifted = current[control.key] + (Math.random() - 0.5) * 2 * spread;
    const snapped = Math.round(drifted / control.step) * control.step;
    next[control.key] = Math.min(control.max, Math.max(control.min, snapped));
  }
  return next;
}
