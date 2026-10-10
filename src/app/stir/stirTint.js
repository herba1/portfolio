import {
  COVER_HUE_SECTORS,
  COVER_NEUTRAL_CHROMA,
  COVER_NEUTRAL_SHARE,
  FALLBACK_INKS,
  INK_CHROMA_FULL,
  INK_CHROMA_GAIN,
  INK_CHROMA_MAX,
  INK_L_MAX,
  INK_L_MIN,
  INK_L_NEUTRAL,
} from "./stirParams";

const SAMPLE_SIZE = 12;
const GAMUT_STEPS = 12;

function toLinear(channel) {
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

function toGamma(channel) {
  return channel <= 0.0031308 ? channel * 12.92 : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
}

function toOklab(red, green, blue) {
  const r = toLinear(red);
  const g = toLinear(green);
  const b = toLinear(blue);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab(lightness, a, b) {
  const l = Math.pow(lightness + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(lightness - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(lightness - 0.0894841775 * a - 1.291485548 * b, 3);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function inGamut(linear) {
  return linear.every((channel) => channel >= -1e-4 && channel <= 1 + 1e-4);
}

function inkFromLab(lightness, a, b) {
  const chroma = Math.hypot(a, b);
  const hue = Math.atan2(b, a);
  const vivid = Math.min(1, chroma / INK_CHROMA_FULL);
  const targetL = INK_L_NEUTRAL + (Math.min(INK_L_MAX, Math.max(INK_L_MIN, lightness)) - INK_L_NEUTRAL) * vivid;
  let targetC = Math.min(INK_CHROMA_MAX, chroma * INK_CHROMA_GAIN);
  let linear = fromOklab(targetL, Math.cos(hue) * targetC, Math.sin(hue) * targetC);
  for (let step = 0; step < GAMUT_STEPS && !inGamut(linear); step += 1) {
    targetC *= 0.85;
    linear = fromOklab(targetL, Math.cos(hue) * targetC, Math.sin(hue) * targetC);
  }
  return linear.map((channel) => toGamma(Math.min(1, Math.max(0, channel))));
}

export function inkFrom(red, green, blue) {
  const [lightness, a, b] = toOklab(red, green, blue);
  return inkFromLab(lightness, a, b);
}

export function chromaOf(red, green, blue) {
  const [, a, b] = toOklab(red, green, blue);
  return Math.hypot(a, b);
}

function hexInk(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return inkFrom(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255);
}

function coverColour(image) {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE_SIZE;
  canvas.height = SAMPLE_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
  let pixels;
  try {
    pixels = context.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE).data;
  } catch {
    return null;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
  const pixelCount = pixels.length / 4;
  const sectorWeight = new Float64Array(COVER_HUE_SECTORS);
  const sectorA = new Float64Array(COVER_HUE_SECTORS);
  const sectorB = new Float64Array(COVER_HUE_SECTORS);
  const sectorL = new Float64Array(COVER_HUE_SECTORS);
  const sectorCount = new Float64Array(COVER_HUE_SECTORS);
  let meanL = 0;
  let meanA = 0;
  let meanB = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    const [lightness, a, b] = toOklab(pixels[index] / 255, pixels[index + 1] / 255, pixels[index + 2] / 255);
    meanL += lightness;
    meanA += a;
    meanB += b;
    const chromaSquared = a * a + b * b;
    const turn = (Math.atan2(b, a) + Math.PI) / (Math.PI * 2);
    const sector = Math.min(COVER_HUE_SECTORS - 1, Math.floor(turn * COVER_HUE_SECTORS));
    sectorWeight[sector] += chromaSquared;
    sectorA[sector] += a * chromaSquared;
    sectorB[sector] += b * chromaSquared;
    sectorL[sector] += lightness;
    sectorCount[sector] += 1;
  }
  let best = -1;
  let bestScore = 0;
  for (let sector = 0; sector < COVER_HUE_SECTORS; sector += 1) {
    const before = sectorWeight[(sector + COVER_HUE_SECTORS - 1) % COVER_HUE_SECTORS];
    const after = sectorWeight[(sector + 1) % COVER_HUE_SECTORS];
    const score = sectorWeight[sector] + (before + after) * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = sector;
    }
  }
  const neutralFloor = COVER_NEUTRAL_CHROMA * COVER_NEUTRAL_CHROMA * COVER_NEUTRAL_SHARE * pixelCount;
  if (best < 0 || bestScore < neutralFloor) return inkFromLab(meanL / pixelCount, meanA / pixelCount, meanB / pixelCount);
  let weight = 0;
  let a = 0;
  let b = 0;
  let lightness = 0;
  let count = 0;
  for (let offset = -1; offset <= 1; offset += 1) {
    const sector = (best + offset + COVER_HUE_SECTORS) % COVER_HUE_SECTORS;
    weight += sectorWeight[sector];
    a += sectorA[sector];
    b += sectorB[sector];
    lightness += sectorL[sector];
    count += sectorCount[sector];
  }
  return inkFromLab(lightness / count, a / weight, b / weight);
}

export function createPalette(tracks) {
  const fallback = FALLBACK_INKS.map(hexInk);
  const colours = new Float32Array(Math.max(1, tracks.length) * 3);
  tracks.forEach((_, index) => colours.set(fallback[index % fallback.length], index * 3));
  return colours;
}

export function loadCoverInks(tracks, colours) {
  const images = [];
  const byUrl = new Map();
  tracks.forEach((track, index) => {
    const url = track.image ?? track.imageFallback;
    if (!url) return;
    if (!byUrl.has(url)) byUrl.set(url, { fallback: track.imageFallback ?? null, indices: [] });
    byUrl.get(url).indices.push(index);
  });
  const ready = Promise.all(
    Array.from(byUrl, ([url, { fallback, indices }]) =>
      new Promise((resolve) => {
        const image = new Image();
        images.push(image);
        image.crossOrigin = "anonymous";
        image.decoding = "async";
        image.onload = () => {
          const ink = coverColour(image);
          if (ink) for (const index of indices) colours.set(ink, index * 3);
          resolve();
        };
        let retried = false;
        image.onerror = () => {
          if (fallback && fallback !== url && !retried) {
            retried = true;
            image.src = fallback;
            return;
          }
          resolve();
        };
        image.src = url;
      }),
    ),
  );
  return {
    ready,
    cancel() {
      for (const image of images) {
        image.onload = null;
        image.onerror = null;
        image.src = "";
      }
      images.length = 0;
    },
  };
}
