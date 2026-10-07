const IDLE = 0;
const LOADING = 1;
const READY = 2;
const FAILED = 3;
const SAMPLE = 6;
const WHITE_MIX = 0.8;
const FALLBACK_TINT = "rgb(246 246 243)";

function tintOf(image) {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE;
  canvas.height = SAMPLE;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, SAMPLE, SAMPLE);
  const { data } = context.getImageData(0, 0, SAMPLE, SAMPLE);
  let best = -1;
  let red = 255;
  let green = 255;
  let blue = 255;
  for (let index = 0; index < data.length; index += 4) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const light = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    const score = light + chroma * 0.35;
    if (score > best) {
      best = score;
      red = r;
      green = g;
      blue = b;
    }
  }
  const mix = (channel) => Math.round(channel * (1 - WHITE_MIX) + 255 * WHITE_MIX);
  return `rgb(${mix(red)} ${mix(green)} ${mix(blue)})`;
}

export function createCoverQueue(covers) {
  const entries = covers.map((cover) => ({ cover, status: IDLE, tint: FALLBACK_TINT, promise: null }));
  let alive = true;

  const wrap = (index) => ((index % entries.length) + entries.length) % entries.length;

  function ensure(index) {
    if (!entries.length) return Promise.resolve(null);
    const entry = entries[wrap(index)];
    if (entry.promise) return entry.promise;
    entry.status = LOADING;
    entry.promise = new Promise((resolve) => {
      const image = new Image();
      image.crossOrigin = "anonymous";
      image.decoding = "async";
      const finish = (ok) => {
        if (!alive) return resolve(entry);
        if (ok) {
          try {
            entry.tint = tintOf(image);
          } catch {
            entry.tint = FALLBACK_TINT;
          }
          entry.status = READY;
        } else {
          entry.status = FAILED;
        }
        resolve(entry);
      };
      image.onload = () => {
        if (image.decode) image.decode().then(() => finish(true), () => finish(true));
        else finish(true);
      };
      image.onerror = () => finish(false);
      image.src = entry.cover.image;
    });
    return entry.promise;
  }

  function get(index) {
    return entries.length ? entries[wrap(index)] : null;
  }

  function usable(index) {
    if (!entries.length) return index;
    for (let step = 0; step < entries.length; step += 1) {
      if (get(index + step).status !== FAILED) return index + step;
    }
    return index;
  }

  function whenReady(indices, timeoutMs) {
    const all = Promise.all(indices.map(ensure));
    const timeout = new Promise((resolve) => setTimeout(resolve, timeoutMs));
    return Promise.race([all, timeout]);
  }

  function dispose() {
    alive = false;
  }

  return { ensure, get, usable, whenReady, dispose, size: entries.length, isReady: (index) => get(index)?.status === READY };
}
