export const PENS = [
  {
    id: "brush",
    label: "Brush",
    short: "Brush",
    nib: { min: 0.6, max: 6, contrast: 0.3, thinAtSpeed: 0.3, base: 0.3, pool: 5, bead: 13, smear: 0.75, pressure: 1 },
    sim: { pin: 0.05, mobility: 0.95, granulation: 0.8, concentration: 2.4, poolConcentration: 0.12 },
    absorb: 1.2,
    dry: 0.8,
  },
  {
    id: "fountain",
    label: "Fountain pen",
    short: "Fountain",
    nib: { min: 0.4, max: 3, contrast: 1, thinAtSpeed: 0.42, base: 0.16, pool: 4, bead: 9, smear: 0.55, pressure: 0.6 },
    sim: { pin: 0.12, mobility: 0.9, granulation: 0.55, concentration: 3.2, poolConcentration: 0.118 },
    absorb: 1,
    dry: 1,
  },
  {
    id: "felt",
    label: "Felt tip",
    short: "Felt tip",
    nib: { min: 1.2, max: 1.5, contrast: 0, thinAtSpeed: 0.85, base: 0.08, pool: 0.8, bead: 2.5, smear: 0.2, pressure: 0.2 },
    sim: { pin: 0.2, mobility: 0.5, granulation: 0, concentration: 6.25, poolConcentration: 0.12 },
    absorb: 0.55,
    dry: 1.8,
  },
];

export const INKS = [
  { id: "iron-gall", label: "Iron gall", hex: "#1d2740" },
  { id: "sepia", label: "Sepia", hex: "#5b3a29" },
  { id: "indigo", label: "Indigo", hex: "#2b3a67" },
  { id: "vermilion", label: "Vermilion", hex: "#c8402b" },
];

export const ABSORB_RANGE = { min: 0.3, max: 1.35, step: 0.05 };
export const DRY_RANGE = { min: 0.4, max: 2.5, step: 0.1 };

export const PAPER_HEX = "#fdfbf7";

export function hexToLinear(hex) {
  const value = parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  return channels.map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
}

export function penById(id) {
  return PENS.find((pen) => pen.id === id) ?? PENS[0];
}

export function inkById(id) {
  return INKS.find((ink) => ink.id === id) ?? INKS[0];
}
