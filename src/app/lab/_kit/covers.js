import { ALBUMS, albumById } from "@/app/lab/_music/catalog";

export { ALBUMS, albumById };

const cache = new Map();
export function loadImage(src) {
  if (!cache.has(src))
    cache.set(
      src,
      new Promise((resolve, reject) => {
        const img = new Image();
        img.decoding = "async";
        img.crossOrigin = "anonymous";
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = src;
      }),
    );
  return cache.get(src);
}

export const loadCover = (id) => loadImage(albumById(id).cover);
