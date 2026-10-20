import {
  STIPPLE_TONE,
  createStipple,
  decodePoints,
  densityFromPixels,
  describePoints,
  normalizedPoints,
  relax,
} from "./stippleSolve";

export const BASKET_CROP = [0.11, 0.34, 0.06, 0.034];

function pixelsOf(image, crop, maxSide) {
  const sourceWidth = image.naturalWidth || image.width;
  const sourceHeight = image.naturalHeight || image.height;
  const sx = sourceWidth * crop[0];
  const sy = sourceHeight * crop[1];
  const sw = sourceWidth * (1 - crop[0] - crop[2]);
  const sh = sourceHeight * (1 - crop[1] - crop[3]);
  const scale = maxSide / Math.max(sw, sh);
  const width = Math.max(8, Math.round(sw * scale));
  const height = Math.max(8, Math.round(sh * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, width, height);
  return { pixels: ctx.getImageData(0, 0, width, height).data, width, height, aspect: sw / sh };
}

export function bakedStipple(pointsImage, sourceImage) {
  const w = pointsImage.naturalWidth;
  const h = pointsImage.naturalHeight;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true, colorSpace: "srgb" });
  ctx.drawImage(pointsImage, 0, 0);
  const points = decodePoints(ctx.getImageData(0, 0, w, h).data, w * h);
  const source = pixelsOf(sourceImage, BASKET_CROP, 520);
  const field = densityFromPixels(source.pixels, source.width, source.height, STIPPLE_TONE);
  const { info, radius } = describePoints(points, field);
  return { points, info, radius, aspect: source.aspect };
}

export function solveStipple(image, { count = 64000, iterations = 18, signal } = {}) {
  const source = pixelsOf(image, [0, 0, 0, 0], 520);
  const field = densityFromPixels(source.pixels, source.width, source.height, { ...STIPPLE_TONE, paper: 0.35, gamma: 2 });
  const state = createStipple(field, count, 11);
  return new Promise((resolve, reject) => {
    let done = 0;
    const step = () => {
      if (signal?.aborted) {
        reject(new Error("aborted"));
        return;
      }
      relax(state, 1);
      done += 1;
      if (done < iterations) {
        setTimeout(step, 0);
        return;
      }
      const points = normalizedPoints(state);
      const { info, radius } = describePoints(points, field);
      resolve({ points, info, radius, aspect: source.aspect });
    };
    setTimeout(step, 0);
  });
}
