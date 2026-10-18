export function balanceLines(text, max) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= 1) return [text.trim()];
  const count = Math.min(max, words.length);
  const goal = words.join(" ").length / count;
  const lines = [];
  let current = [];
  words.forEach((word, i) => {
    current.push(word);
    const remainingWords = words.length - i - 1;
    const remainingSlots = count - lines.length - 1;
    if (
      remainingSlots > 0 &&
      remainingWords >= remainingSlots &&
      (current.join(" ").length >= goal || remainingWords === remainingSlots)
    ) {
      lines.push(current.join(" "));
      current = [];
    }
  });
  if (current.length) lines.push(current.join(" "));
  return lines;
}

export function readCover(canvas, image, w, h, x, y, side) {
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.imageSmoothingQuality = "high";
  const iw = image.naturalWidth || image.width;
  const ih = image.naturalHeight || image.height;
  const crop = Math.min(iw, ih);
  ctx.drawImage(
    image,
    (iw - crop) / 2,
    (ih - crop) / 2,
    crop,
    crop,
    x,
    y,
    side,
    side,
  );
  let data;
  try {
    data = ctx.getImageData(0, 0, w, h).data;
  } catch {
    return null;
  }
  const out = new Uint8ClampedArray(data.length);
  for (let py = 0; py < h; py += 1) {
    const inside = py >= y && py < y + side;
    for (let px = 0; px < w; px += 1) {
      const i = (py * w + px) * 4;
      if (!inside || px < x || px >= x + side) {
        out[i + 2] = 128;
        out[i + 3] = 128;
        continue;
      }
      const r = data[i] / 255;
      const g = data[i + 1] / 255;
      const b = data[i + 2] / 255;
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      const cb = (b - luma) / 1.772;
      const cr = (r - luma) / 1.402;
      const film = Math.min(
        1.25,
        -Math.log(Math.max(0.03, luma / 0.94)) / 4.6 + 0.012,
      );
      out[i] = Math.round((Math.max(0, film) / 1.25) * 255);
      out[i + 1] = 255;
      out[i + 2] = Math.round((cb + 0.5) * 255);
      out[i + 3] = Math.round((cr + 0.5) * 255);
    }
  }
  return out;
}
