export const DEFAULT_IMAGE = "/cast/paul.webp";

const PLATE_BASE = {
  fill: 1,
  tile: 1,
  zoom: 0.9,
  offsetX: 0,
  offsetY: 0,

  warpX: 0.3,
  warpY: 0.52,
  curve: 0.9,
  tiltX: 0.55,
  tiltY: -0.2,
  spin: -12,

  cell: 22,
  cellAspect: 1.35,
  cellPower: 3.6,
  gridAngle: 14,
  lensRadius: 0.58,
  lensPower: 0.5,

  refract: 18,
  dispersion: 0.8,

  black: 0.05,
  white: 0.85,
  gamma: 1.1,
  sweep: 1.2,
  sweepAngle: 20,
  imageMix: 0.35,
  relief: 1.0,

  c0: "#ead7e2",
  c1: "#f4c3a2",
  c2: "#f0894a",
  c3: "#e0432a",
  c4: "#5b2ce0",

  specStrength: 0.26,
  specPower: 12,
  lightAngle: 130,
  specColour: "#ffe9d8",
  metal: 0.12,
  rimDark: 0.1,

  grain: 0.14,
  grainChroma: 0.8,

  seed: 3.4,
  supersample: 1,
};

export const REFRACT_PRESETS = [
  { name: "Lens", values: {} },
  {
    name: "Chrome",
    values: {
      metal: 0.85,
      specStrength: 0.5,
      specPower: 26,
      rimDark: 0.5,
      lensPower: 0.45,
      refract: 24,
      dispersion: 0.75,
      c0: "#101a3a",
      c1: "#3f5fa8",
      c2: "#9fb6d8",
      c3: "#e6d7c2",
      c4: "#fff6ea",
      specColour: "#ffffff",
      grain: 0.09,
      grainChroma: 0.3,
    },
  },
  {
    name: "Bubble",
    values: {
      cell: 17,
      cellAspect: 1,
      cellPower: 2.2,
      lensRadius: 0.62,
      lensPower: 0.5,
      refract: 28,
      dispersion: 0.95,
      metal: 0.15,
      specStrength: 0.35,
      specPower: 30,
      rimDark: 0.22,
      curve: 1.3,
      sweep: 0.5,
    },
  },
  {
    name: "Foil",
    values: {
      cell: 40,
      cellAspect: 1.9,
      cellPower: 5,
      lensRadius: 0.46,
      lensPower: 1.1,
      refract: 14,
      dispersion: 0.35,
      metal: 0.7,
      specStrength: 0.4,
      specPower: 8,
      rimDark: 0.45,
      c0: "#1b0f3a",
      c1: "#7b2fa8",
      c2: "#d9365c",
      c3: "#f2a03c",
      c4: "#f7e6b8",
      grain: 0.18,
      grainChroma: 1.1,
    },
  },
  {
    name: "Mercury",
    values: {
      cell: 22,
      cellAspect: 1.2,
      cellPower: 2.6,
      lensRadius: 0.58,
      lensPower: 0.55,
      refract: 34,
      dispersion: 0.2,
      metal: 0.95,
      specStrength: 0.55,
      specPower: 18,
      rimDark: 0.6,
      curve: 1.5,
      sweep: 0.15,
      c0: "#05070c",
      c1: "#39424f",
      c2: "#8d97a4",
      c3: "#cdd4dc",
      c4: "#ffffff",
      specColour: "#ffffff",
      grain: 0.07,
      grainChroma: 0.15,
    },
  },
];

export function presetValues(preset) {
  return { ...PLATE_BASE, ...preset.values };
}

export const DEFAULT_PRESET = "Lens";

export const REFRACT_DEFAULTS = presetValues(
  REFRACT_PRESETS.find((preset) => preset.name === DEFAULT_PRESET),
);

export const REFRACT_GROUPS = [
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
    name: "Lenses",
    controls: [
      { key: "cell", label: "Frequency", min: 4, max: 120, step: 0.5 },
      { key: "cellAspect", label: "Cell stretch", min: 0.4, max: 3, step: 0.005 },
      { key: "cellPower", label: "Cell squareness", min: 1.2, max: 8, step: 0.02 },
      { key: "gridAngle", label: "Grid angle", min: -90, max: 90, step: 0.5, unit: "°" },
      { key: "lensRadius", label: "Lens reach", min: 0.15, max: 1.2, step: 0.005 },
      { key: "lensPower", label: "Lens profile", min: 0.2, max: 3, step: 0.005 },
    ],
  },
  {
    name: "Refraction",
    controls: [
      { key: "refract", label: "Magnify", min: 0, max: 50, step: 0.05 },
      { key: "dispersion", label: "Dispersion", min: 0, max: 1.6, step: 0.005 },
    ],
  },
  {
    name: "Field",
    controls: [
      { key: "black", label: "Black point", min: 0, max: 0.95, step: 0.002 },
      { key: "white", label: "White point", min: 0.05, max: 1, step: 0.002 },
      { key: "gamma", label: "Gamma", min: 0.25, max: 3, step: 0.005 },
      { key: "sweep", label: "Gradient sweep", min: -3, max: 3, step: 0.005 },
      { key: "sweepAngle", label: "Sweep angle", min: -180, max: 180, step: 1, unit: "°" },
      { key: "imageMix", label: "Image weight", min: 0, max: 1, step: 0.005 },
    ],
  },
  {
    name: "Palette",
    controls: [
      { key: "c0", label: "Stop 1", type: "color" },
      { key: "c1", label: "Stop 2", type: "color" },
      { key: "c2", label: "Stop 3", type: "color" },
      { key: "c3", label: "Stop 4", type: "color" },
      { key: "c4", label: "Stop 5", type: "color" },
    ],
  },
  {
    name: "Surface",
    controls: [
      { key: "relief", label: "Relief", min: 0, max: 4, step: 0.005 },
      { key: "metal", label: "Metal", min: 0, max: 1.4, step: 0.005 },
      { key: "specStrength", label: "Highlight", min: 0, max: 1.2, step: 0.005 },
      { key: "specPower", label: "Highlight tightness", min: 1, max: 60, step: 0.5 },
      { key: "lightAngle", label: "Light angle", min: -180, max: 180, step: 1, unit: "°" },
      { key: "specColour", label: "Highlight colour", type: "color" },
      { key: "rimDark", label: "Rim shade", min: 0, max: 1, step: 0.005 },
    ],
  },
  {
    name: "Stock",
    controls: [
      { key: "grain", label: "Grain", min: 0, max: 0.5, step: 0.002 },
      { key: "grainChroma", label: "Grain colour", min: 0, max: 2, step: 0.005 },
      { key: "seed", label: "Seed", min: 0, max: 40, step: 0.01 },
      { key: "supersample", label: "Supersample", type: "toggle" },
    ],
  },
];

const REROLLABLE = REFRACT_GROUPS.flatMap((group) =>
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
