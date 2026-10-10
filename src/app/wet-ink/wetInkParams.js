export const BRUSH = {
  nib: { min: 0.6, max: 6, contrast: 0.3, thinAtSpeed: 0.3, base: 0.3, pool: 5, bead: 13, smear: 0.75, pressure: 1 },
  sim: { pin: 0.05, mobility: 0.95, granulation: 0.8, concentration: 2.4, poolConcentration: 0.12 },
  absorb: 1.2,
  dry: 0.8,
};

export const INK_HEX = "#1d2740";

export const PAPER_HEX = "#fdfbf7";

export function hexToLinear(hex) {
  const value = parseInt(hex.slice(1), 16);
  const channels = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  return channels.map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
}
