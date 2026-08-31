export const DEFAULT_IMAGE = "/cast/paul.webp";

const PLATE_BASE = {
  fill: 1,
  zoom: 0.9,
  tile: 1,
  chroma: 0.55,
  offsetX: 0,
  offsetY: 0,

  warpX: 0.3,
  warpY: 0.52,
  curve: 0.9,
  tiltX: 0.55,
  tiltY: -0.2,
  spin: -12,

  cell: 44,
  cellAspect: 1.35,
  cellPower: 3.2,
  dotScale: 1.0,
  dotGamma: 0.85,

  black: 0.05,
  white: 0.85,
  gamma: 1.2,

  angleA: 8,
  angleB: 52,
  angleC: 82,
  gainA: 1.0,
  gainB: 0.85,
  gainC: 0.6,
  slipA: 0.006,
  slipB: -0.022,
  slipC: 0.03,

  paper: "#e7d3dd",
  inkA: "#f4622a",
  inkB: "#5b2ce0",
  inkC: "#ffa24a",

  grain: 0.16,
  grainChroma: 0.7,
  bloom: 0.5,

  seed: 3.4,
  supersample: 1,
};

export const HALFTONE_PRESETS = [
  { name: "Bulge", values: {} },
  {
    name: "Flat",
    values: {
      curve: 0.25,
      tiltX: 0.08,
      tiltY: -0.04,
      cell: 46,
      cellAspect: 1,
      cellPower: 2,
      dotScale: 1.45,
      grain: 0.1,
      spin: 15,
    },
  },
  {
    name: "Tunnel",
    values: {
      curve: 1.85,
      tiltX: 0.9,
      tiltY: 0.35,
      cell: 26,
      cellAspect: 1.7,
      cellPower: 4.5,
      dotScale: 1.05,
      warpX: 0.62,
      warpY: 0.44,
      bloom: 0.9,
    },
  },
  {
    name: "Newsprint",
    values: {
      cell: 62,
      cellAspect: 1,
      cellPower: 2,
      dotScale: 1.5,
      dotGamma: 1,
      curve: 0.5,
      tiltX: 0.2,
      tiltY: -0.1,
      grain: 0.09,
      grainChroma: 0.15,
      bloom: 0.1,
      paper: "#efe9df",
      inkA: "#12b5c8",
      inkB: "#e5197d",
      inkC: "#f6d100",
      slipA: 0.006,
      slipB: -0.006,
      slipC: 0.012,
    },
  },
  {
    name: "Ultra",
    values: {
      curve: 1.5,
      cell: 38,
      cellAspect: 1.4,
      cellPower: 4,
      dotScale: 1.0,
      dotGamma: 1.1,
      bloom: 0.55,
      grain: 0.12,
      grainChroma: 0.9,
      paper: "#120a24",
      inkA: "#ff3d6e",
      inkB: "#2ee6ff",
      inkC: "#b06bff",
      gainA: 1.05,
      gainB: 0.9,
      gainC: 0.65,
    },
  },
];

export function presetValues(preset) {
  return { ...PLATE_BASE, ...preset.values };
}

export const DEFAULT_PRESET = "Bulge";

export const HALFTONE_DEFAULTS = presetValues(
  HALFTONE_PRESETS.find((preset) => preset.name === DEFAULT_PRESET),
);

export const HALFTONE_GROUPS = [
  {
    name: "Frame",
    controls: [
      { key: "fill", label: "Fill frame", type: "toggle" },
      { key: "tile", label: "Mirror beyond edge", type: "toggle" },
      { key: "zoom", label: "Zoom", min: 0.2, max: 4, step: 0.005 },
      { key: "offsetX", label: "Pan across", min: -0.8, max: 0.8, step: 0.002 },
      { key: "offsetY", label: "Pan up", min: -0.8, max: 0.8, step: 0.002 },
    ],
  },
  {
    name: "Plate warp",
    controls: [
      { key: "curve", label: "Bulge", min: 0, max: 2.6, step: 0.005 },
      { key: "warpX", label: "Bulge across", min: -0.3, max: 1.3, step: 0.002 },
      { key: "warpY", label: "Bulge up", min: -0.3, max: 1.3, step: 0.002 },
      { key: "tiltX", label: "Tilt across", min: -1.4, max: 1.4, step: 0.005 },
      { key: "tiltY", label: "Tilt up", min: -1.4, max: 1.4, step: 0.005 },
      { key: "spin", label: "Spin", min: -90, max: 90, step: 0.5, unit: "°" },
    ],
  },
  {
    name: "Screen",
    controls: [
      { key: "cell", label: "Frequency", min: 6, max: 140, step: 0.5 },
      { key: "cellAspect", label: "Cell stretch", min: 0.4, max: 3, step: 0.005 },
      { key: "cellPower", label: "Cell squareness", min: 1.2, max: 8, step: 0.02 },
      { key: "dotScale", label: "Dot size", min: 0.3, max: 3, step: 0.005 },
      { key: "dotGamma", label: "Dot gamma", min: 0.3, max: 3, step: 0.005 },
    ],
  },
  {
    name: "Tone",
    controls: [
      { key: "black", label: "Black point", min: 0, max: 0.95, step: 0.002 },
      { key: "white", label: "White point", min: 0.05, max: 1, step: 0.002 },
      { key: "gamma", label: "Gamma", min: 0.25, max: 3, step: 0.005 },
      { key: "chroma", label: "Colour separation", min: 0, max: 1.6, step: 0.005 },
    ],
  },
  {
    name: "Warm ink",
    controls: [
      { key: "inkA", label: "Colour", type: "color" },
      { key: "angleA", label: "Screen angle", min: -90, max: 90, step: 0.5, unit: "°" },
      { key: "gainA", label: "Gain", min: 0, max: 2.5, step: 0.005 },
      { key: "slipA", label: "Misregister", min: -0.06, max: 0.06, step: 0.0005 },
    ],
  },
  {
    name: "Cool ink",
    controls: [
      { key: "inkB", label: "Colour", type: "color" },
      { key: "angleB", label: "Screen angle", min: -90, max: 90, step: 0.5, unit: "°" },
      { key: "gainB", label: "Gain", min: 0, max: 2.5, step: 0.005 },
      { key: "slipB", label: "Misregister", min: -0.06, max: 0.06, step: 0.0005 },
    ],
  },
  {
    name: "Third ink",
    controls: [
      { key: "inkC", label: "Colour", type: "color" },
      { key: "angleC", label: "Screen angle", min: -90, max: 90, step: 0.5, unit: "°" },
      { key: "gainC", label: "Gain", min: 0, max: 2.5, step: 0.005 },
      { key: "slipC", label: "Misregister", min: -0.06, max: 0.06, step: 0.0005 },
    ],
  },
  {
    name: "Stock",
    controls: [
      { key: "paper", label: "Paper", type: "color" },
      { key: "grain", label: "Grain", min: 0, max: 0.5, step: 0.002 },
      { key: "grainChroma", label: "Grain colour", min: 0, max: 2, step: 0.005 },
      { key: "bloom", label: "Ink bloom", min: 0, max: 2, step: 0.005 },
      { key: "seed", label: "Seed", min: 0, max: 40, step: 0.01 },
      { key: "supersample", label: "Supersample", type: "toggle" },
    ],
  },
];

const REROLLABLE = HALFTONE_GROUPS.flatMap((group) =>
  group.controls.filter((control) => !control.type && group.name !== "Frame"),
);

export function rerollValues(current) {
  const next = { ...current, seed: Math.random() * 40 };
  for (const control of REROLLABLE) {
    if (control.key === "seed") continue;
    const spread = (control.max - control.min) * 0.14;
    const drifted = current[control.key] + (Math.random() - 0.5) * 2 * spread;
    const snapped = Math.round(drifted / control.step) * control.step;
    next[control.key] = Math.min(control.max, Math.max(control.min, snapped));
  }
  return next;
}
