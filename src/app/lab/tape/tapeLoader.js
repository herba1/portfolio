import { AUDIO_SOURCES } from "./tapeConstants";
import { SPECTROGRAM_WORKER_SOURCE } from "./spectrogramWorker";

const DECODE_RATE = 44100;

async function decode(source, signal) {
  const response = await fetch(source, { signal });
  if (!response.ok) throw new Error(`audio ${response.status}`);
  const bytes = await response.arrayBuffer();
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const offline = new Offline(1, 1, DECODE_RATE);
  const buffer = await offline.decodeAudioData(bytes);
  const samples = new Float32Array(buffer.length);
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < data.length; i++) samples[i] += data[i] / buffer.numberOfChannels;
  }
  return { samples, sampleRate: buffer.sampleRate };
}

export function loadTape() {
  const controller = new AbortController();
  let worker = null;
  let workerUrl = null;

  const release = () => {
    if (worker) worker.terminate();
    if (workerUrl) URL.revokeObjectURL(workerUrl);
    worker = null;
    workerUrl = null;
  };

  const promise = (async () => {
    let decoded = null;
    for (const source of AUDIO_SOURCES) {
      try {
        decoded = await decode(source, controller.signal);
        break;
      } catch (error) {
        if (controller.signal.aborted) throw error;
      }
    }
    if (controller.signal.aborted) throw new Error("aborted");
    if (!decoded) throw new Error("no playable audio");
    workerUrl = URL.createObjectURL(new Blob([SPECTROGRAM_WORKER_SOURCE], { type: "text/javascript" }));
    worker = new Worker(workerUrl);
    const result = await new Promise((resolve, reject) => {
      worker.onmessage = (event) => resolve(event.data);
      worker.onerror = (event) => reject(event.error || new Error("worker failed"));
      worker.postMessage(decoded, [decoded.samples.buffer]);
    });
    release();
    if (controller.signal.aborted) throw new Error("aborted");
    return result;
  })();

  return {
    promise,
    cancel() {
      controller.abort();
      release();
    },
  };
}
