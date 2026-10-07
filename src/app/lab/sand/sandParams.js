export const GRAIN_OPTIONS = [
  { key: "fine", label: "Fine", px: 2 },
  { key: "sand", label: "Sand", px: 3 },
  { key: "gravel", label: "Gravel", px: 5 },
];

export const DEFAULT_GRAIN = "fine";

export const grainPx = (key) => (GRAIN_OPTIONS.find((option) => option.key === key) ?? GRAIN_OPTIONS[1]).px;

const FALLBACK_CARDS = [
  ["Honus Wagner", "T206 White Border, 1909"],
  ["Ty Cobb", "T206 White Border, 1909"],
  ["Christy Mathewson", "American Tobacco, 1909"],
  ["Cy Young", "American Tobacco, 1909"],
  ["Walter Johnson", "American Tobacco, 1909"],
  ["Nap Lajoie", "American Tobacco, 1909"],
  ["Tris Speaker", "American Tobacco, 1911"],
  ["Willie Keeler", "American Tobacco, 1909"],
  ["Joe Tinker", "American Tobacco, 1909"],
  ["Babe Ruth", "Goudey Big League, 1933"],
  ["Pud Galvin", "Old Judge, 1887"],
  ["King Kelly", "Old Judge, 1889"],
];

export const FALLBACK_COVERS = FALLBACK_CARDS.map(([title, artist], index) => ({
  id: `card-${index + 1}`,
  title,
  artist,
  image: `/flyout/card-${String(index + 1).padStart(2, "0")}.jpg`,
}));
