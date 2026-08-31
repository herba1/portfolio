export const STAR_COUNT = 42000;

const FIELD_BASE = {
  arms: 4,
  twist: 1.7,
  radius: 6.5,
  thickness: 0.32,

  coreBulge: 1.4,
  coreGlow: 1.1,
  warmth: 0.6,

  density: 0.85,
  starSize: 0.045,
  turbulence: 0.18,
  twinkle: 0.35,
  hue: 205,

  spin: 0.06,
  drift: 0.12,

  seed: 3.1,
};

export const GALAXIUM_PRESETS = [
  { name: "Spiral Arm", values: {} },
  {
    name: "Barred Core",
    values: {
      arms: 2,
      twist: 0.9,
      radius: 7.5,
      thickness: 0.5,
      coreBulge: 2.4,
      coreGlow: 1.6,
      warmth: 0.85,
      density: 0.9,
      hue: 28,
      spin: 0.03,
      drift: 0.08,
    },
  },
  {
    name: "Quasar",
    values: {
      arms: 6,
      twist: 3.2,
      radius: 4,
      thickness: 0.18,
      coreBulge: 0.6,
      coreGlow: 2,
      warmth: 0.95,
      density: 0.95,
      starSize: 0.06,
      turbulence: 0.4,
      twinkle: 0.55,
      hue: 18,
      spin: 0.34,
      drift: 0.4,
    },
  },
  {
    name: "Deep Field",
    values: {
      arms: 5,
      twist: 2.4,
      radius: 11,
      thickness: 0.22,
      coreBulge: 0.5,
      coreGlow: 0.6,
      warmth: 0.3,
      density: 0.4,
      starSize: 0.03,
      turbulence: 0.08,
      twinkle: 0.2,
      hue: 232,
      spin: 0.015,
      drift: 0.03,
    },
  },
];

export function presetValues(preset) {
  return { ...FIELD_BASE, ...preset.values };
}

export const DEFAULT_PRESET = "Spiral Arm";

export const GALAXIUM_DEFAULTS = presetValues(
  GALAXIUM_PRESETS.find((preset) => preset.name === DEFAULT_PRESET),
);

export const GALAXIUM_GROUPS = [
  {
    name: "Shape",
    controls: [
      { key: "arms", label: "Spiral arms", min: 2, max: 7, step: 1 },
      { key: "twist", label: "Arm twist", min: 0.2, max: 5, step: 0.05 },
      { key: "radius", label: "Galaxy radius", min: 3, max: 12, step: 0.1 },
      { key: "thickness", label: "Disc thickness", min: 0, max: 1.2, step: 0.01 },
    ],
  },
  {
    name: "Core",
    controls: [
      { key: "coreBulge", label: "Bulge height", min: 0, max: 3, step: 0.05 },
      { key: "coreGlow", label: "Core glow", min: 0, max: 2, step: 0.02 },
      { key: "warmth", label: "Core warmth", min: 0, max: 1, step: 0.01 },
    ],
  },
  {
    name: "Field",
    controls: [
      { key: "density", label: "Star density", min: 0.15, max: 1, step: 0.01 },
      { key: "starSize", label: "Star size", min: 0.015, max: 0.12, step: 0.001 },
      { key: "turbulence", label: "Turbulence", min: 0, max: 1, step: 0.01 },
      { key: "twinkle", label: "Twinkle", min: 0, max: 1, step: 0.01 },
      { key: "hue", label: "Arm hue", min: 0, max: 360, step: 1, unit: "°" },
    ],
  },
  {
    name: "Motion",
    controls: [
      { key: "spin", label: "Spin speed", min: -1, max: 1, step: 0.01 },
      { key: "drift", label: "Idle drift", min: 0, max: 1, step: 0.01 },
    ],
  },
];

const REROLLABLE = GALAXIUM_GROUPS.flatMap((group) => group.controls);

export function rerollValues(current) {
  const next = { ...current, seed: Math.random() * 100 };
  for (const control of REROLLABLE) {
    const spread = (control.max - control.min) * 0.14;
    const drifted = current[control.key] + (Math.random() - 0.5) * 2 * spread;
    const snapped = Math.round(drifted / control.step) * control.step;
    next[control.key] = Math.min(control.max, Math.max(control.min, snapped));
  }
  return next;
}
