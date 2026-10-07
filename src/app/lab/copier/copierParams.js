export const SHEET_WIDTH = 1024;
export const SHEET_HEIGHT = 1280;

export const SOURCES = [
  { id: "wagner", label: "Honus Wagner, 1909", url: "/flyout/card-01.jpg", gen: 0, kind: "image" },
  { id: "cobb", label: "Ty Cobb, 1909", url: "/flyout/card-02.jpg", gen: 0, kind: "image" },
  { id: "ruth", label: "Babe Ruth, 1933", url: "/flyout/card-10.jpg", gen: 0, kind: "image" },
  { id: "mathewson", label: "Christy Mathewson, 1909", url: "/flyout/card-03.jpg", gen: 0, kind: "image" },
  { id: "john", label: "John", url: "/cast/john.webp", gen: 0, kind: "image" },
  { id: "paul", label: "Paul", url: "/cast/paul.webp", gen: 0, kind: "image" },
  { id: "george", label: "George", url: "/cast/george.webp", gen: 0, kind: "image" },
];

export const COPIER_BASE = {
  threshold: 0.5,
  contrast: 0.74,
  grain: 0.5,
  streaks: 0.45,
  scanSeconds: 2.8,
};

export const COPIER_PRESETS = [
  {
    name: "Xerox",
    index: 0,
    values: {},
    paper: "#f9f8f4",
    ink: "#141414",
    inkB: "#141414",
  },
  {
    name: "Riso",
    index: 1,
    values: { threshold: 0.47, contrast: 0.62, grain: 0.72, streaks: 0.16 },
    paper: "#f7f3ec",
    ink: "#0078bf",
    inkB: "#ff48b0",
  },
  {
    name: "Fax",
    index: 2,
    values: { threshold: 0.52, contrast: 0.92, grain: 0.62, streaks: 0.3 },
    paper: "#f2ebd9",
    ink: "#3a3936",
    inkB: "#3a3936",
  },
  {
    name: "Diazo",
    index: 3,
    values: { threshold: 0.45, contrast: 0.36, grain: 0.34, streaks: 0.22 },
    paper: "#f3f0e3",
    ink: "#253a9e",
    inkB: "#253a9e",
  },
];

export const DEFAULT_PRESET = COPIER_PRESETS[0];

export const COPIER_CONTROLS = [
  { key: "threshold", label: "Threshold", min: 0.2, max: 0.8, step: 0.01 },
  { key: "contrast", label: "Contrast", min: 0, max: 1, step: 0.01 },
  { key: "grain", label: "Grain", min: 0, max: 1, step: 0.01 },
  { key: "streaks", label: "Streaks", min: 0, max: 1, step: 0.01 },
  { key: "scanSeconds", label: "Scan time", min: 1.6, max: 5, step: 0.1, unit: "s" },
];

export const PLATEN_COLOUR = "#e6eaef";

export function presetValues(preset, keep) {
  const values = { ...COPIER_BASE, ...preset.values };
  if (keep) values.scanSeconds = keep.scanSeconds;
  return values;
}

export function hexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}
