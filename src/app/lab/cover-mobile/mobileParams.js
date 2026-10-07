export const MOBILE_DEFAULTS = {
  wind: 1,
  damping: 1,
  gravity: 2000,
  count: null,
  seed: 7,
};

export const MOBILE_CONTROLS = [
  { key: "wind", label: "Wind", min: 0, max: 2, step: 0.05, digits: 2, unit: "×" },
  { key: "damping", label: "Air damping", min: 0.4, max: 3, step: 0.05, digits: 2, unit: "×" },
  { key: "gravity", label: "Gravity", min: 800, max: 3200, step: 50, digits: 0, unit: "px/s²" },
  { key: "count", label: "Covers", min: 5, max: 8, step: 1, digits: 0, unit: "" },
];

export const WIDE_COUNT = 8;
export const NARROW_COUNT = 6;
export const MAX_COUNT = 8;

export function physicsFor(params) {
  return {
    gravity: params.gravity,
    wind: params.wind,
    linearDamping: 2 / params.damping,
    angularDamping: 1.5 / params.damping,
  };
}

export function nextSeed(seed) {
  return ((seed * 1103515245 + 12345) >>> 0) % 100000;
}

const LARGE_ART = "ab67616d0000b273";
const SMALL_ART = "ab67616d00001e02";

export function largeArt(url) {
  return typeof url === "string" ? url.replace(SMALL_ART, LARGE_ART) : url;
}

export function isLocalScan(cover) {
  return !cover || cover.artist === "Local scans";
}
