import { loadStored, storeParams, clearStored } from "@/app/ui/paramStore";

export const STORAGE_KEY = "herb:develop:params";

export const DEVELOP_DEFAULTS = {
  preset: "Warm fibre",
  depth: 0.08,
  slosh: 0.997,
  speed: 1,
  contrast: 1,
  grain: 0.05,
  fog: 0.012,
  lith: 0,
  paper: "#f7f5f0",
  silver: "#1a1612",
};

export const DEVELOP_PRESETS = [
  { name: "Warm fibre", values: { paper: "#f7f5f0", silver: "#1a1612", fog: 0.012, lith: 0, contrast: 1, grain: 0.05, speed: 1 } },
  { name: "Cold tone", values: { paper: "#f4f6f6", silver: "#14171c", fog: 0.012, lith: 0, contrast: 1.12, grain: 0.04, speed: 1 } },
  { name: "Lith", values: { paper: "#f3e6d8", silver: "#3a2218", fog: 0.02, lith: 1, contrast: 1.3, grain: 0.08, speed: 1 } },
  { name: "Overdeveloped", values: { paper: "#f5f2ea", silver: "#1a1612", fog: 0.04, lith: 0, contrast: 0.9, grain: 0.06, speed: 1.6 } },
];

export const DEVELOP_CONTROLS = [
  { key: "depth", label: "Developer depth", min: 0.04, max: 0.16, step: 0.01 },
  { key: "slosh", label: "Slosh", min: 0.99, max: 0.999, step: 0.001 },
  { key: "speed", label: "Development speed", min: 0.5, max: 3, step: 0.1, unit: "×" },
  { key: "contrast", label: "Contrast", min: 0.7, max: 1.6, step: 0.05 },
  { key: "grain", label: "Grain", min: 0, max: 0.1, step: 0.01 },
];

export function applyPreset(current, preset) {
  return { ...current, ...preset.values, preset: preset.name };
}

const listeners = new Set();
let cached = null;

export function readStoredParams() {
  if (cached) return cached;
  cached = loadStored(STORAGE_KEY, DEVELOP_DEFAULTS) ?? DEVELOP_DEFAULTS;
  return cached;
}

export function serverParams() {
  return DEVELOP_DEFAULTS;
}

export function writeStoredParams(next) {
  cached = next;
  storeParams(STORAGE_KEY, next);
  for (const listener of listeners) listener();
}

export function resetStoredParams() {
  cached = DEVELOP_DEFAULTS;
  clearStored(STORAGE_KEY);
  for (const listener of listeners) listener();
}

export function subscribeParams(listener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function formatValue(value, step) {
  if (step >= 1) return String(Math.round(value));
  const decimals = step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  return value.toFixed(decimals);
}
