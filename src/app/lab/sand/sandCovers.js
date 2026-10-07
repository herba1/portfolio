import { hashCell } from "./sandGrid";
import { FALLBACK_COVERS } from "./sandParams";

export const COVER_TEXTURE_SIZE = 512;
const SAND_SATURATION = 1.18;
const SHADE_SPREAD = 0.1;
const LAST_RESORT = FALLBACK_COVERS[0];

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      const ready = image.decode ? image.decode().catch(() => undefined) : Promise.resolve();
      ready.then(() => resolve(image));
    };
    image.onerror = () => reject(new Error(`cover failed: ${src}`));
    image.src = src;
  });
}

function squareCanvas(image) {
  const canvas = document.createElement("canvas");
  canvas.width = COVER_TEXTURE_SIZE;
  canvas.height = COVER_TEXTURE_SIZE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  const side = Math.min(image.naturalWidth, image.naturalHeight);
  const sourceX = (image.naturalWidth - side) / 2;
  const sourceY = (image.naturalHeight - side) * 0.3;
  context.drawImage(image, sourceX, sourceY, side, side, 0, 0, COVER_TEXTURE_SIZE, COVER_TEXTURE_SIZE);
  context.getImageData(0, 0, 1, 1);
  return canvas;
}

export async function loadCover(cover) {
  try {
    const image = await loadImage(cover.image);
    return { ...cover, canvas: squareCanvas(image), cells: new Map() };
  } catch {
    const image = await loadImage(LAST_RESORT.image);
    return {
      ...cover,
      title: LAST_RESORT.title,
      artist: LAST_RESORT.artist,
      substitute: true,
      canvas: squareCanvas(image),
      cells: new Map(),
    };
  }
}

export function sampleCells(cover, size) {
  const cached = cover.cells.get(size);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(cover.canvas, 0, 0, size, size);
  const { data } = context.getImageData(0, 0, size, size);
  const rgba = new Uint8Array(size * size * 4);
  const light = new Uint8Array(size * size);
  let red = 0;
  let green = 0;
  let blue = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const cell = y * size + x;
      const at = cell * 4;
      const r = data[at];
      const g = data[at + 1];
      const b = data[at + 2];
      red += r;
      green += g;
      blue += b;
      const grey = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const shade = 1 - SHADE_SPREAD / 2 + SHADE_SPREAD * hashCell(x, y);
      rgba[at] = Math.max(0, Math.min(255, (grey + (r - grey) * SAND_SATURATION) * shade));
      rgba[at + 1] = Math.max(0, Math.min(255, (grey + (g - grey) * SAND_SATURATION) * shade));
      rgba[at + 2] = Math.max(0, Math.min(255, (grey + (b - grey) * SAND_SATURATION) * shade));
      rgba[at + 3] = 255;
      light[cell] = Math.min(255, grey);
    }
  }
  const count = size * size;
  const sample = {
    size,
    rgba,
    light,
    average: [Math.round(red / count), Math.round(green / count), Math.round(blue / count)],
  };
  cover.cells.set(size, sample);
  return sample;
}
