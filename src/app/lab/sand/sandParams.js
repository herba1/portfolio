export const GRAIN_OPTIONS = [
  { key: "fine", label: "Fine", px: 2 },
  { key: "sand", label: "Sand", px: 3 },
  { key: "gravel", label: "Gravel", px: 5 },
];

export const DEFAULT_GRAIN = "fine";

export const grainPx = (key) => (GRAIN_OPTIONS.find((option) => option.key === key) ?? GRAIN_OPTIONS[1]).px;

export const FALLBACK_COVERS = Array.from({ length: 12 }, (_, index) => ({
  id: `card-${index + 1}`,
  title: `Card ${String(index + 1).padStart(2, "0")}`,
  artist: "Local scans",
  image: `/flyout/card-${String(index + 1).padStart(2, "0")}.jpg`,
}));
