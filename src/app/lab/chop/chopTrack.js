import { analysisRegion, cropBuffer, reverseBuffer, sliceTrack } from "./chopSlicer";

const FALLBACK_SOURCE = "/audio/ask-me-why.m4a";
const DECODE_RATE = 44100;
const DECODED_KEEP = 2;

const encoded = new Map();
const decoded = new Map();
let fallback = null;

class StaleTrack extends Error {}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`audio ${response.status}`);
  return response.arrayBuffer();
}

async function decode(bytes) {
  const offline = new OfflineAudioContext(2, 1, DECODE_RATE);
  return offline.decodeAudioData(bytes.slice(0));
}

async function buildTrack(bytes, source, abandoned) {
  const audio = await decode(bytes);
  if (abandoned()) throw new StaleTrack();
  const region = analysisRegion(audio.duration);
  const forward = cropBuffer(audio, region.start, region.end);
  const analysis = await sliceTrack(forward);
  if (abandoned()) throw new StaleTrack();
  const reversed = reverseBuffer(forward);
  return {
    ...analysis,
    forward,
    reversed,
    sixteenth: analysis.stepSeconds / analysis.beatsPerSlice / 4,
    source,
  };
}

function previewBytes(cover) {
  const key = cover.id;
  if (!encoded.has(key)) {
    const query = new URLSearchParams({ artist: cover.artist ?? "", title: cover.title ?? "" });
    const request = fetch(`/api/spotify/preview?${query}`)
      .then((response) => {
        if (!response.ok) throw new Error("no preview");
        return response.json();
      })
      .then((body) => {
        if (!body?.url) throw new Error("no preview");
        return fetchBytes(body.url);
      });
    request.catch(() => {
      if (encoded.get(key) === request) encoded.delete(key);
    });
    encoded.set(key, request);
  }
  return encoded.get(key);
}

function fallbackTrack() {
  if (!fallback) {
    const pending = fetchBytes(FALLBACK_SOURCE).then((bytes) => buildTrack(bytes, "fallback", () => false));
    pending.catch(() => {
      if (fallback === pending) fallback = null;
    });
    fallback = pending;
  }
  return fallback;
}

export function prefetchTrack(cover) {
  if (!cover) return;
  previewBytes(cover).catch(() => null);
}

export function loadTrack(cover, isStale = () => false) {
  const key = cover.id;
  const cached = decoded.get(key);
  if (cached) {
    cached.isStale = isStale;
    decoded.delete(key);
    decoded.set(key, cached);
    return cached.promise;
  }
  const entry = { isStale, promise: null };
  const abandoned = () => entry.isStale();
  entry.promise = previewBytes(cover)
    .then((bytes) => buildTrack(bytes, "preview", abandoned))
    .catch((error) => {
      if (error instanceof StaleTrack) throw error;
      return fallbackTrack();
    });
  entry.promise.catch(() => {
    if (decoded.get(key) === entry) decoded.delete(key);
  });
  decoded.set(key, entry);
  while (decoded.size > DECODED_KEEP) decoded.delete(decoded.keys().next().value);
  return entry.promise;
}

export function clearTracks() {
  decoded.clear();
  encoded.clear();
  fallback = null;
}
