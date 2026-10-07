export const BLOCK_SIZES = [8, 16, 32];

export const MOSH_DEFAULTS = {
  block: 16,
  persistence: 1.4,
  residual: 0.035,
  ringing: 0.35,
  subsample: true,
  vectors: false,
};

export const MOSH_PRESETS = [
  { name: "H.264", values: {} },
  { name: "MPEG-2", values: { block: 8, residual: 0.06, ringing: 0.8, persistence: 1.1 } },
  { name: "Bloom", values: { persistence: 4, residual: 0.02, ringing: 0.2 } },
  { name: "Slab", values: { block: 32, persistence: 1.8, residual: 0.03 } },
];

export const DEFAULT_PRESET = "H.264";

export const MOSH_SLIDERS = [
  { key: "persistence", label: "Persistence", min: 0.4, max: 6, step: 0.1, unit: "s", digits: 1 },
  { key: "residual", label: "Residual", min: 0, max: 0.1, step: 0.005, unit: "", digits: 3 },
  { key: "ringing", label: "Ringing", min: 0, max: 1, step: 0.05, unit: "", digits: 2 },
];

export function presetValues(preset) {
  return { ...MOSH_DEFAULTS, ...preset.values };
}

export function matchPreset(params) {
  const keys = ["block", "persistence", "residual", "ringing", "subsample"];
  const found = MOSH_PRESETS.find((preset) => {
    const values = presetValues(preset);
    return keys.every((key) => values[key] === params[key]);
  });
  return found ? found.name : null;
}

export function sanitiseParams(incoming) {
  if (!incoming || typeof incoming !== "object") return null;
  const next = { ...MOSH_DEFAULTS };
  if (BLOCK_SIZES.includes(incoming.block)) next.block = incoming.block;
  for (const slider of MOSH_SLIDERS) {
    const value = incoming[slider.key];
    if (typeof value === "number" && Number.isFinite(value)) next[slider.key] = Math.min(slider.max, Math.max(slider.min, value));
  }
  if (typeof incoming.subsample === "boolean") next.subsample = incoming.subsample;
  if (typeof incoming.vectors === "boolean") next.vectors = incoming.vectors;
  return next;
}
