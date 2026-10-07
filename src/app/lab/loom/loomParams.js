export const WEAVES = [
  { id: 0, label: "Plain" },
  { id: 1, label: "Twill" },
  { id: 2, label: "Satin" },
];

export const PRESETS = [
  { id: "silk", label: "Silk", values: { tension: 90, coupling: 5600, damping: 3.5 } },
  { id: "linen", label: "Linen", values: { tension: 120, coupling: 4800, damping: 4 } },
  { id: "canvas", label: "Canvas", values: { tension: 240, coupling: 800, damping: 15 } },
];

export const DEFAULT_PRESET = "linen";

export const DEFAULTS = {
  weave: 1,
  threads: null,
  sound: true,
  preset: DEFAULT_PRESET,
  ...PRESETS[1].values,
};

export const THREADS_MIN = 48;
export const THREADS_MAX = 128;
export const THREADS_STEP = 8;
export const THREADS_WIDE = 96;
export const THREADS_NARROW = 64;

export const SLIDERS = [
  { key: "tension", label: "Tension", min: 60, max: 320, step: 10 },
  { key: "coupling", label: "Coupling", min: 200, max: 8000, step: 100 },
  { key: "damping", label: "Damping", min: 2, max: 24, step: 0.5 },
];

export function presetFor(values) {
  const match = PRESETS.find((preset) =>
    Object.entries(preset.values).every(([key, value]) => values[key] === value),
  );
  return match ? match.id : null;
}
