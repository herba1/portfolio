const LEVEL_WIDTHS = [640, 128, 64, 32];
const OPTIMISER_QUALITY = 75;
const EXPORT_SIZE = 1600;
const EXPORT_GUTTER = 10;
const EXPORT_RADIUS = 18;

function makeCanvas(size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function loadImage(src, anonymous) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    if (anonymous) image.crossOrigin = "anonymous";
    image.decoding = "async";
    image.onload = () => {
      const decoded = image.decode ? image.decode() : Promise.resolve();
      decoded.catch(() => null).then(() => resolve(image));
    };
    image.onerror = () => reject(new Error("image failed"));
    image.src = src;
  });
}

function squareCrop(image) {
  const width = image.naturalWidth || image.width;
  const height = image.naturalHeight || image.height;
  const side = Math.min(width, height);
  return { x: (width - side) / 2, y: (height - side) / 2, side };
}

function canvasUrl(canvas) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => (blob ? resolve(URL.createObjectURL(blob)) : reject(new Error("blob"))), "image/png");
    } catch (error) {
      reject(error);
    }
  });
}

function optimisable(src) {
  if (src.startsWith("/")) return !src.startsWith("//");
  try {
    const url = new URL(src);
    return url.protocol === "https:" && (url.hostname === "i.scdn.co" || url.hostname.endsWith(".spotifycdn.com"));
  } catch {
    return false;
  }
}

export function coverSource(cover) {
  return cover?.imageLarge || cover?.image || "";
}

export function artLevels(src) {
  if (!src) return [];
  if (!optimisable(src)) return LEVEL_WIDTHS.map(() => src);
  return LEVEL_WIDTHS.map((width) => `/_next/image?url=${encodeURIComponent(src)}&w=${width}&q=${OPTIMISER_QUALITY}`);
}

export async function prepareArt(cover) {
  const src = coverSource(cover);
  const levels = artLevels(src);
  if (levels[0] !== src) {
    const loaded = await Promise.all(levels.map((url) => loadImage(url, false))).catch(() => null);
    if (loaded) return { levels, image: loaded[0], exportable: true };
  }
  const raw = LEVEL_WIDTHS.map(() => src);
  const shared = await loadImage(src, true).catch(() => null);
  if (shared) return { levels: raw, image: shared, exportable: true };
  const plain = await loadImage(src, false);
  return { levels: raw, image: plain, exportable: false };
}

export function exportPattern(art, pattern, name) {
  if (!art?.exportable) return Promise.resolve(false);
  const canvas = makeCanvas(EXPORT_SIZE);
  const context = canvas.getContext("2d");
  const crop = squareCrop(art.image);
  const tile = (EXPORT_SIZE - EXPORT_GUTTER * 3) / 4;
  const sourceTile = crop.side / 4;
  context.imageSmoothingQuality = "high";
  for (let step = 0; step < 16; step += 1) {
    const slice = pattern[step];
    const x = (step % 4) * (tile + EXPORT_GUTTER);
    const y = Math.floor(step / 4) * (tile + EXPORT_GUTTER);
    context.save();
    context.beginPath();
    context.roundRect(x, y, tile, tile, EXPORT_RADIUS);
    context.clip();
    context.drawImage(
      art.image,
      crop.x + (slice % 4) * sourceTile,
      crop.y + Math.floor(slice / 4) * sourceTile,
      sourceTile,
      sourceTile,
      x,
      y,
      tile,
      tile,
    );
    context.restore();
  }
  return canvasUrl(canvas)
    .then((url) => {
      const link = document.createElement("a");
      link.href = url;
      link.download = `${name || "chop"}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      return true;
    })
    .catch(() => false);
}
