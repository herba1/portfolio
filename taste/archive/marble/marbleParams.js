export const PLATE_BASE = {
  lambda: 0.035,
  dropSize: 0.1,
  rimWeight: 1.2,
  rimDark: 0.55,
  lag: 70,
  grain: 0.035,
  paper: "#f5f2ea",
  seed: 1,
};

export const MARBLE_PRESETS = [
  { name: "Stone", recipe: "stone", values: { lambda: 0.04, rimWeight: 1.4 } },
  { name: "Nonpareil", recipe: "nonpareil", values: { lambda: 0.028, rimWeight: 1 } },
  { name: "Bouquet", recipe: "bouquet", values: {} },
  { name: "Spiral", recipe: "spiral", values: { lambda: 0.05, rimWeight: 1.3 } },
  { name: "Chevron", recipe: "chevron", values: { lambda: 0.03, rimWeight: 1.1, rimDark: 0.5 } },
];

export const DEFAULT_PRESET = "Bouquet";

export const MARBLE_DEFAULTS = presetValues(MARBLE_PRESETS.find((preset) => preset.name === DEFAULT_PRESET));

export function presetValues(preset) {
  return { ...PLATE_BASE, ...(preset?.values ?? {}) };
}

export const MARBLE_GROUPS = [
  {
    name: "Bath",
    controls: [
      { key: "lambda", label: "Tine sharpness", min: 0.015, max: 0.08, step: 0.001 },
      { key: "dropSize", label: "Drop size", min: 0.03, max: 0.2, step: 0.005 },
      { key: "lag", label: "Liquid lag", min: 0, max: 160, step: 5, unit: "ms" },
    ],
  },
  {
    name: "Print",
    controls: [
      { key: "rimWeight", label: "Rim weight", min: 0, max: 2.4, step: 0.1, unit: "px" },
      { key: "rimDark", label: "Rim darkness", min: 0.3, max: 0.8, step: 0.01 },
      { key: "grain", label: "Grain", min: 0, max: 0.08, step: 0.005 },
      { key: "paper", label: "Paper", type: "color" },
    ],
  },
];

export function rerollValues(values, random) {
  const next = { ...values };
  for (const group of MARBLE_GROUPS) {
    for (const control of group.controls) {
      if (control.type || control.key === "lag") continue;
      const range = control.max - control.min;
      const nudged = values[control.key] + (random() * 2 - 1) * range * 0.16;
      const snapped = Math.round(nudged / control.step) * control.step;
      next[control.key] = Number(Math.min(control.max, Math.max(control.min, snapped)).toFixed(4));
    }
  }
  next.seed = Math.round((1 + random() * 998) * 10) / 10;
  return next;
}
