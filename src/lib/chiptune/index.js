// Audio in, chiptune out. A song or a snippet of one is transcribed by Basic
// Pitch, split into melody, chords, bass and drums, and rebuilt for a 2A03-style
// chip (synth.js). Everything runs in the browser; the model loads on first use.
//
//   const { song, analysis, midi } = await convertToChiptune(fileOrUrl, { onProgress });
//   // song plays through synth.js (renderSong, or see skinAudio); midi() is a
//   // .mid file with the chip parts and the transcription they came from

import { analyze } from "./analyze";
import { arrange } from "./arrange";
import { decodeToMono } from "./audio";
import { ConvertError } from "./errors";
import { conversionToMidi } from "./midi";
import { RATE } from "./model";

export { analyze } from "./analyze";
export { arrange } from "./arrange";
export { decodeToMono } from "./audio";
export { ConvertError } from "./errors";
export { analysisToMidi, conversionToMidi, songToMidi, writeMidi } from "./midi";
export { loadModel } from "./model";

// The model and the analysis run in a worker, so a conversion never stalls
// the page; one worker is shared so the model loads once. Cancelling one
// request tells the worker to drop it, and never takes down another caller's.
let worker = null;
let nextId = 0;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  const w = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  w.addEventListener("message", ({ data }) => pending.get(data.id)?.(data));
  w.addEventListener("error", (e) => {
    if (worker === w) worker = null;
    w.terminate();
    const err = e.error ?? new Error(e.message || "The converter crashed");
    for (const settle of [...pending.values()]) settle({ error: err });
  });
  worker = w;
  return w;
}

// Frees the worker (and the model it holds) once nobody is waiting on it.
export function releaseWorker() {
  if (!worker || pending.size) return;
  worker.terminate();
  worker = null;
}

function analyzeInWorker(mono, { onProgress, signal }) {
  signal?.throwIfAborted?.();
  const w = getWorker();
  const id = (nextId += 1);
  return new Promise((resolve, reject) => {
    const done = () => {
      pending.delete(id);
      signal?.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      done();
      w.postMessage({ cancel: id });
      reject(new DOMException("Aborted", "AbortError"));
    };
    pending.set(id, (data) => {
      if (data.progress != null) return onProgress?.(data.progress);
      done();
      if (data.error) reject(data.error instanceof Error ? data.error : new Error(data.error));
      else resolve(data.analysis);
    });
    signal?.addEventListener("abort", onAbort);
    w.postMessage({ id, mono }, [mono.buffer]);
  });
}

const rms = (x) => {
  let s = 0;
  for (let i = 0; i < x.length; i += 1) s += x[i] * x[i];
  return Math.sqrt(s / (x.length || 1));
};

export async function convertToChiptune(input, { title, artist, maxSeconds = 30, model, onProgress, signal, inWorker = typeof Worker !== "undefined" && !model } = {}) {
  onProgress?.(0);
  const { mono, offset, sourceDuration } = await decodeToMono(input, { maxSeconds, signal });
  if (mono.length < RATE * 3) throw new ConvertError("too-short", "Need at least three seconds of audio");
  // -50 dBFS: digital silence or a recording of the room.
  if (rms(mono) < 0.003) throw new ConvertError("silent", "That audio is silent");
  onProgress?.(0.05);
  const opts = { model, signal, onProgress: (p) => onProgress?.(0.05 + p * 0.93) };
  const analysis = inWorker ? await analyzeInWorker(mono, opts) : await analyze(mono, opts);
  // Chords alone can come from the model's background hum, and noise reads as
  // one endless drone per line. Every test song moves at 2.7 notes a second or
  // more across melody and bass; ask for a tenth of that.
  const lines = [...analysis.melody, ...analysis.bass];
  const voiced = lines.reduce((t, n) => t + n.end - n.start, 0);
  if (lines.length < 0.3 * analysis.duration || voiced < 1.5) throw new ConvertError("no-notes", "No notes found in that audio");
  const song = arrange(analysis, { title, artist });
  onProgress?.(1);
  return {
    song,
    analysis,
    offset,
    sourceDuration,
    // The chip parts and the raw transcription together; songToMidi and
    // analysisToMidi write either one alone.
    midi: () => conversionToMidi(song, analysis, { offset }),
  };
}
