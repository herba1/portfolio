import { FRAME_COUNT, SPLIT } from "./lenticularCards";

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function face(img, size) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, size, size);
  return canvas;
}

export async function cardLayers(card, size) {
  const [a, b] = await Promise.all([loadImage(card.front.cover), loadImage(card.back.cover)]);
  const front = face(a, size);
  const back = face(b, size);
  return Array.from({ length: FRAME_COUNT }, (_, i) => (i < SPLIT ? front : back));
}
