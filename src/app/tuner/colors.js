// Shared accent-color logic for the tuner. Pure.
// Idle / no pitch → cyan (the VFD phosphor). Active → green when in tune,
// easing toward amber the further off-pitch you are.

export const CYAN = [63, 233, 218];
export const AMBER = [255, 178, 74];
export const GREEN = [87, 240, 140];

// Dark LCD segment ink (matches --seg in tuner.css) for the calculator display.
export const INK = [31, 36, 22];

export function lerp3(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/** @param {{cents:number|null, inTune:boolean, active:boolean}} s */
export function tuneColorRGB(s) {
  if (!s || !s.active || s.cents == null) return CYAN;
  if (s.inTune) return GREEN;
  const t = Math.min(1, Math.abs(s.cents) / 50); // 0 centered … 1 far
  return lerp3(GREEN, AMBER, t);
}

export function rgbCss(rgb, alpha = 1) {
  return `rgba(${rgb[0] | 0}, ${rgb[1] | 0}, ${rgb[2] | 0}, ${alpha})`;
}
