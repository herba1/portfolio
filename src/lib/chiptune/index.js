// Audio in, chiptune out. A song or a snippet of one is transcribed by Basic
// Pitch, split into melody, chords, bass and drums, and rebuilt for a 2A03-style
// chip (synth.js). Everything runs in the browser; the model loads on first use.
//
//   const { song, analysis, midi } = await convertToChiptune(fileOrUrl, { onProgress });
//   // song plays through synth.js (see skinAudio), midi() is a .mid file

import { analyze } from "./analyze";
import { arrange } from "./arrange";
import { decodeToMono } from "./audio";
import { songToMidi } from "./midi";

export { analyze } from "./analyze";
export { arrange } from "./arrange";
export { decodeToMono } from "./audio";
export { songToMidi } from "./midi";
export { loadModel } from "./model";

// The model and the analysis run in a worker, so a conversion never stalls
// the page; one worker is kept so the model loads once.
let worker = null;
let nextId = 0;

function analyzeInWorker(mono, { onProgress, signal }) {
  worker ??= new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  const w = worker;
  const id = (nextId += 1);
  return new Promise((resolve, reject) => {
    const done = () => {
      w.removeEventListener("message", onMessage);
      w.removeEventListener("error", onError);
      signal?.removeEventListener("abort", onAbort);
    };
    const onMessage = ({ data }) => {
      if (data.id !== id) return;
      if (data.progress != null) return onProgress?.(data.progress);
      done();
      if (data.error) reject(new Error(data.error));
      else resolve(data.analysis);
    };
    const onError = (e) => {
      done();
      if (worker === w) worker = null;
      w.terminate();
      reject(e.error ?? new Error(e.message || "worker failed"));
    };
    const onAbort = () => {
      done();
      if (worker === w) worker = null;
      w.terminate();
      reject(new DOMException("Aborted", "AbortError"));
    };
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
    signal?.addEventListener("abort", onAbort);
    w.postMessage({ id, mono }, [mono.buffer]);
  });
}

export async function convertToChiptune(input, { title, artist, maxSeconds = 30, model, onProgress, signal, inWorker = typeof Worker !== "undefined" && !model } = {}) {
  onProgress?.(0);
  const { mono, offset, sourceDuration } = await decodeToMono(input, { maxSeconds, signal });
  if (mono.length < 22050 * 3) throw new Error("Need at least three seconds of audio");
  onProgress?.(0.05);
  const opts = { model, signal, onProgress: (p) => onProgress?.(0.05 + p * 0.93) };
  const analysis = inWorker ? await analyzeInWorker(mono, opts) : await analyze(mono, opts);
  if (!analysis.melody.length && !analysis.bass.length && !analysis.chords.some((c) => c.root != null)) throw new Error("No notes found in that audio");
  const song = arrange(analysis, { title, artist });
  onProgress?.(1);
  return { song, analysis, offset, sourceDuration, midi: () => songToMidi(song, analysis.beats) };
}
