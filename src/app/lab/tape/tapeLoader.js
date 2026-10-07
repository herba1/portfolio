import {
  AUDIO_SOURCES,
  CLIP_OFFSET_SECONDS,
  CLIP_SECONDS,
  CLIP_TOLERANCE_SECONDS,
  FULL_RECORDING_SECONDS,
  TRACK,
} from "./tapeConstants";
import { SPECTROGRAM_WORKER_SOURCE } from "./spectrogramWorker";

const DECODE_RATE = 44100;

async function fetchBytes(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`audio ${response.status}`);
  return response.arrayBuffer();
}

async function previewBytes(signal) {
  const query = new URLSearchParams({ artist: TRACK.artist, title: TRACK.title });
  const lookup = await fetch(`/api/spotify/preview?${query}`, { signal });
  if (lookup.status === 404 || lookup.status === 400) throw new Error("no preview");
  if (lookup.ok) {
    const payload = await lookup.json().catch(() => null);
    if (payload?.url) {
      try {
        return await fetchBytes(payload.url, signal);
      } catch (error) {
        if (signal.aborted) throw error;
      }
    }
  }
  query.set("stream", "1");
  return fetchBytes(`/api/spotify/preview?${query}`, signal);
}

async function decode(source, signal) {
  const bytes = source.preview ? await previewBytes(signal) : await fetchBytes(source.url, signal);
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const offline = new Offline(1, 1, DECODE_RATE);
  const buffer = await offline.decodeAudioData(bytes);
  const rate = buffer.sampleRate;
  const duration = buffer.length / rate;
  let from = 0;
  let to = buffer.length;
  let offset = null;
  if (duration >= FULL_RECORDING_SECONDS) {
    from = Math.min(buffer.length - 1, Math.round(CLIP_OFFSET_SECONDS * rate));
    to = Math.min(buffer.length, from + Math.round(CLIP_SECONDS * rate));
    offset = CLIP_OFFSET_SECONDS;
  } else if (Math.abs(duration - CLIP_SECONDS) <= CLIP_TOLERANCE_SECONDS) {
    offset = CLIP_OFFSET_SECONDS;
  }
  const samples = new Float32Array(to - from);
  const share = 1 / buffer.numberOfChannels;
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    const data = buffer.getChannelData(channel);
    for (let i = 0; i < samples.length; i++) samples[i] += data[from + i] * share;
  }
  return { samples, sampleRate: rate, offset };
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
    const { samples, sampleRate, offset } = decoded;
    workerUrl = URL.createObjectURL(new Blob([SPECTROGRAM_WORKER_SOURCE], { type: "text/javascript" }));
    worker = new Worker(workerUrl);
    const result = await new Promise((resolve, reject) => {
      worker.onmessage = (event) => resolve(event.data);
      worker.onerror = (event) => reject(event.error || new Error("worker failed"));
      worker.postMessage({ samples, sampleRate }, [samples.buffer]);
    });
    release();
    if (controller.signal.aborted) throw new Error("aborted");
    return { ...result, offset };
  })();

  return {
    promise,
    cancel() {
      controller.abort();
      release();
    },
  };
}
