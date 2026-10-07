export const MAX_MAGNETS = 3;
export const MAX_FILINGS = 9000;
export const MIN_FILINGS = 3200;
export const MOBILE_MAX_FILINGS = 4000;
export const PLATE_AREA_PER_FILING = 60;
export const CHIP_COUNT = 6;

export const FILINGS_DEFAULTS = {
  density: 100,
  length: 100,
  field: 20,
  wobble: 50,
  creep: 60,
};

export const FILINGS_CONTROLS = [
  { key: "density", label: "Density", min: 40, max: 100, step: 5, unit: "%" },
  { key: "length", label: "Length", min: 50, max: 170, step: 5, unit: "%" },
  { key: "field", label: "Field strength", min: 8, max: 34, step: 1, unit: "%" },
  { key: "wobble", label: "Wobble", min: 0, max: 100, step: 1, unit: "%" },
  { key: "creep", label: "Creep", min: 0, max: 100, step: 1, unit: "%" },
];

export const FILINGS_LOOKS = [
  {
    name: "Iron",
    paper: "#f5f2ea",
    ink: "#1a1a1a",
    tint: false,
    invert: false,
  },
  {
    name: "Cover colour",
    paper: "#f5f2ea",
    ink: "#1a1a1a",
    tint: true,
    invert: false,
  },
  {
    name: "Blueprint",
    paper: "#1d3a6e",
    ink: "#f0ede4",
    tint: false,
    invert: true,
  },
];

export const DEFAULT_LOOK = FILINGS_LOOKS[0];

export const FALLBACK_CHIPS = Array.from({ length: CHIP_COUNT }, (_, index) => {
  const number = String(index + 1).padStart(2, "0");
  return { id: `local-card-${number}`, title: `Card ${number}`, artist: "Local scans", image: `/flyout/card-${number}.jpg` };
});

export function filingCount(plateSize, density, compact) {
  const cap = compact ? MOBILE_MAX_FILINGS : MAX_FILINGS;
  const areaCeiling = Math.max(MIN_FILINGS, (plateSize * plateSize) / PLATE_AREA_PER_FILING);
  const ceiling = Math.min(cap, areaCeiling);
  return Math.round(ceiling * (density / 100));
}

export function hexToRgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}
