// Spotify's Basic Pitch (Apache-2.0, weights in /public/models/basic-pitch),
// run through tfjs directly rather than the @spotify/basic-pitch package: that
// package pins tfjs 3, never disposes its tensors, and its note decoder is
// quadratic. This file only produces the model's three posteriorgrams; notes.js
// turns them into notes.

import yieldToMain from "../yieldToMain";

export const RATE = 22050;
export const HOP = 256;
export const PITCHES = 88;
export const CONTOUR_BINS = 264;
export const MIDI_OFFSET = 21;
const WINDOW = RATE * 2 - HOP;
const OVERLAP_FRAMES = 30;
const OVERLAP = OVERLAP_FRAMES * HOP;
const STRIDE = WINDOW - OVERLAP;
const TRIM = OVERLAP_FRAMES / 2;
const WINDOW_FRAMES = 172;
const KEPT = WINDOW_FRAMES - 2 * TRIM;
const FPS = Math.floor(RATE / HOP);

// Each window keeps 142 frames but only advances 141.3 frames of audio, so a
// plain f * HOP drifts ~9ms per window; place frames by the window they came from.
export const frameTime = (f) => (Math.floor(f / KEPT) * STRIDE + (f % KEPT) * HOP) / RATE;

const loading = new Map();

async function backend(tf) {
  // WebGL on a page or, through OffscreenCanvas, in a worker; Node gets the CPU.
  if (typeof document !== "undefined" || typeof OffscreenCanvas !== "undefined") {
    try {
      await import("@tensorflow/tfjs-backend-webgl");
      if (await tf.setBackend("webgl")) return;
    } catch {}
  }
  await import("@tensorflow/tfjs-backend-cpu");
  await tf.setBackend("cpu");
}

// `source` is the model.json URL, or any tfjs IOHandler (tests load from disk).
export function loadModel(source = "/models/basic-pitch/model.json") {
  if (loading.has(source)) return loading.get(source);
  const promise = (async () => {
    const tf = await import("@tensorflow/tfjs-core");
    const { loadGraphModel } = await import("@tensorflow/tfjs-converter");
    await backend(tf);
    await tf.ready();
    const model = await loadGraphModel(source);
    return { tf, model, backend: tf.getBackend() };
  })();
  loading.set(source, promise);
  promise.catch(() => loading.delete(source));
  return promise;
}

// mono: Float32Array at 22050Hz. Returns flat row-major matrices, one row per
// model frame (~86 per second).
export async function posteriorgrams(mono, { model: source, onProgress, signal } = {}) {
  const { tf, model, backend: used } = await loadModel(source);
  const nFrames = Math.floor(mono.length / STRIDE) * KEPT + Math.floor((mono.length % STRIDE) / HOP);
  const frames = new Float32Array(nFrames * PITCHES);
  const onsets = new Float32Array(nFrames * PITCHES);
  const contours = new Float32Array(nFrames * CONTOUR_BINS);
  const windows = Math.ceil(nFrames / KEPT);
  const chunk = new Float32Array(WINDOW);
  let row = 0;
  for (let w = 0; w < windows && row < nFrames; w += 1) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    chunk.fill(0);
    const from = w * STRIDE - OVERLAP / 2;
    for (let i = Math.max(0, -from); i < WINDOW && from + i < mono.length; i += 1) chunk[i] = mono[from + i];
    const input = tf.tensor3d(chunk, [1, WINDOW, 1]);
    const out = model.execute(input, ["Identity_1", "Identity_2", "Identity"]);
    const [f, o, c] = await Promise.all(out.map((t) => t.data()));
    input.dispose();
    out.forEach((t) => t.dispose());
    const take = Math.min(KEPT, nFrames - row);
    frames.set(f.subarray(TRIM * PITCHES, (TRIM + take) * PITCHES), row * PITCHES);
    onsets.set(o.subarray(TRIM * PITCHES, (TRIM + take) * PITCHES), row * PITCHES);
    contours.set(c.subarray(TRIM * CONTOUR_BINS, (TRIM + take) * CONTOUR_BINS), row * CONTOUR_BINS);
    row += take;
    onProgress?.((w + 1) / windows);
    await yieldToMain();
  }
  return { frames, onsets, contours, nFrames, fps: FPS, backend: used };
}
