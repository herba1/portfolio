const SAMPLE_SIDE = 40;
const CHROMA_FULL = 0.082;
const COHERENCE_FLOOR = 0.4;
const SHADE_CENTRE = 0.58;
const SHADE_SPREAD = 0.34;
const FLAT_CHROMA = 1e-5;
const MIN_WEIGHT = 1e-6;
const OPAQUE_ENOUGH = 128;

function toLinear(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function okLab(red, green, blue) {
  const r = toLinear(red);
  const g = toLinear(green);
  const b = toLinear(blue);
  const long = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const medium = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const short = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return {
    lightness: 0.2104542553 * long + 0.793617785 * medium - 0.0040720468 * short,
    a: 1.9779984951 * long - 2.428592205 * medium + 0.4505937099 * short,
    b: 0.0259040371 * long + 0.7827717662 * medium - 0.808675766 * short,
  };
}

function shadeWeight(lightness) {
  const offset = (lightness - SHADE_CENTRE) / SHADE_SPREAD;
  return Math.exp(-0.5 * offset * offset);
}

export function coverPalette(image) {
  if (typeof document === "undefined" || !image) return null;
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIDE;
  canvas.height = SAMPLE_SIDE;
  const context = canvas.getContext("2d");
  if (!context) return null;
  let pixels = null;
  try {
    context.drawImage(image, 0, 0, SAMPLE_SIDE, SAMPLE_SIDE);
    pixels = context.getImageData(0, 0, SAMPLE_SIDE, SAMPLE_SIDE).data;
  } catch {
    return null;
  }
  let vectorA = 0;
  let vectorB = 0;
  let chromaSum = 0;
  let weightSum = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3] < OPAQUE_ENOUGH) continue;
    const { lightness, a, b } = okLab(pixels[offset], pixels[offset + 1], pixels[offset + 2]);
    const chroma = Math.hypot(a, b);
    if (chroma < FLAT_CHROMA) continue;
    const weight = chroma * shadeWeight(lightness);
    vectorA += (weight * a) / chroma;
    vectorB += (weight * b) / chroma;
    chromaSum += weight * chroma;
    weightSum += weight;
  }
  if (weightSum < MIN_WEIGHT) return null;
  const coherence = Math.hypot(vectorA, vectorB) / weightSum;
  const vividness = Math.min(1, chromaSum / weightSum / CHROMA_FULL);
  const strength = Math.min(1, vividness * (COHERENCE_FLOOR + (1 - COHERENCE_FLOOR) * coherence));
  const hue = ((Math.atan2(vectorB, vectorA) * 180) / Math.PI + 360) % 360;
  return { hue, strength };
}
