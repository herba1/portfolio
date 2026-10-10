import { cropFor } from "./developEngine";

const CAST = [
  { id: "john", label: "John", src: "/cast/john.webp", focusY: 0.5 },
  { id: "paul", label: "Paul", src: "/cast/paul.webp", focusY: 0.5 },
  { id: "george", label: "George", src: "/cast/george.webp", focusY: 0.5 },
];

const CARDS = [
  ["Wagner", "01"],
  ["Cobb", "02"],
  ["Mathewson", "03"],
  ["Young", "04"],
  ["Johnson", "05"],
  ["Lajoie", "06"],
  ["Speaker", "07"],
  ["Keeler", "08"],
  ["Tinker", "09"],
  ["Ruth", "10"],
  ["Galvin", "11"],
  ["Kelly", "12"],
].map(([label, number]) => ({
  id: `card-${number}`,
  label,
  src: `/flyout/card-${number}.jpg`,
  focusY: 0.36,
}));

const MAX_COVERS = 8;

export function buildSources(covers) {
  const seen = new Set();
  const fromCovers = [];
  for (const cover of covers ?? []) {
    if (!cover?.image || seen.has(cover.image)) continue;
    seen.add(cover.image);
    fromCovers.push({ id: `cover-${cover.id ?? cover.image}`, label: cover.title || "Cover", src: cover.image, focusY: 0.5 });
    if (fromCovers.length >= MAX_COVERS) break;
  }
  return [...CAST, ...CARDS, ...fromCovers];
}

function measureLevels(image, crop) {
  try {
    const width = 48;
    const height = 60;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return { black: 0, white: 1 };
    const naturalWidth = image.naturalWidth || image.width;
    const naturalHeight = image.naturalHeight || image.height;
    context.drawImage(
      image,
      crop.x * naturalWidth,
      (1 - crop.y - crop.height) * naturalHeight,
      crop.width * naturalWidth,
      crop.height * naturalHeight,
      0,
      0,
      width,
      height,
    );
    const { data } = context.getImageData(0, 0, width, height);
    const luma = new Float32Array(width * height);
    for (let index = 0; index < luma.length; index += 1) {
      const offset = index * 4;
      luma[index] = (0.2126 * data[offset] + 0.7152 * data[offset + 1] + 0.0722 * data[offset + 2]) / 255;
    }
    luma.sort();
    const at = (quantile) => luma[Math.floor(quantile * (luma.length - 1))];
    const black = Math.max(0, at(0.02) - 0.02);
    const white = Math.min(1, Math.max(black + 0.2, at(0.985) + 0.02));
    return { black, white };
  } catch {
    return { black: 0, white: 1 };
  }
}

const cache = new Map();

export function loadSource(source) {
  const cached = cache.get(source.src);
  if (cached) return cached;
  const pending = new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      const decoded = typeof image.decode === "function" ? image.decode().catch(() => undefined) : Promise.resolve();
      decoded.then(() => resolve(image));
    };
    image.onerror = () => reject(new Error(`could not load ${source.src}`));
    image.src = source.src;
  }).then((image) => {
    const crop = cropFor(image.naturalWidth, image.naturalHeight, 0.5, source.focusY ?? 0.5);
    return { image, crop, levels: measureLevels(image, crop) };
  });
  pending.catch(() => cache.delete(source.src));
  cache.set(source.src, pending);
  return pending;
}

export function warmSource(source) {
  return loadSource(source).catch(() => null);
}
