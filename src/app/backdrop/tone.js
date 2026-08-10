const CACHE = new Map();
const SAMPLE = 12;

function compute(image) {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE;
  canvas.height = SAMPLE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;

  context.drawImage(image, 0, 0, SAMPLE, SAMPLE);

  let pixels;
  try {
    pixels = context.getImageData(0, 0, SAMPLE, SAMPLE).data;
  } catch {
    return null;
  }

  let red = 0;
  let green = 0;
  let blue = 0;
  let total = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const r = pixels[index];
    const g = pixels[index + 1];
    const b = pixels[index + 2];
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    const weight = 0.3 + chroma / 200;
    red += r * weight;
    green += g * weight;
    blue += b * weight;
    total += weight;
  }
  if (!total) return null;

  red /= total;
  green /= total;
  blue /= total;

  const luminance = (0.2126 * red + 0.7152 * green + 0.0722 * blue) / 255;
  const lift = Math.min(luminance < 0.18 ? 0.18 / Math.max(luminance, 0.02) : 1, 2.4);
  const liftedRed = Math.min(255, Math.round(red * lift));
  const liftedGreen = Math.min(255, Math.round(green * lift));
  const liftedBlue = Math.min(255, Math.round(blue * lift));

  const liftedLuminance =
    (0.2126 * liftedRed + 0.7152 * liftedGreen + 0.0722 * liftedBlue) / 255;
  const pale = liftedLuminance > 0.52;

  return {
    luminance,
    tint: `${liftedRed}, ${liftedGreen}, ${liftedBlue}`,
    ink: pale ? "#0d0d0f" : "#ffffff",
    inkSoft: pale ? "rgba(13, 13, 15, 0.62)" : "rgba(255, 255, 255, 0.74)",
  };
}

export function readTone(image) {
  const key = image.currentSrc || image.src;
  if (!key) return null;
  if (!CACHE.has(key)) CACHE.set(key, compute(image));
  return CACHE.get(key);
}

export function toneMode(tone) {
  return tone && tone.luminance > 0.52 ? "light" : "dark";
}
