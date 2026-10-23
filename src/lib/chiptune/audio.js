// Any audio the browser can decode, as mono 22050Hz samples (the model's
// rate). Long songs are cut to the loudest stretch of `maxSeconds`: a chorus
// says more about a song than its intro.

import { RATE } from "./model";

const Offline = () => globalThis.OfflineAudioContext || globalThis.webkitOfflineAudioContext;

async function toArrayBuffer(input, signal) {
  if (typeof input === "string") {
    const res = await fetch(input, { signal });
    if (!res.ok) throw new Error(`Could not fetch audio (${res.status})`);
    return res.arrayBuffer();
  }
  if (typeof Blob !== "undefined" && input instanceof Blob) return input.arrayBuffer();
  return input;
}

export function loudestWindow(data, rate, seconds) {
  const total = data.length / rate;
  if (total <= seconds) return 0;
  const block = Math.floor(rate / 2);
  const energy = [];
  for (let i = 0; i + block <= data.length; i += block) {
    let s = 0;
    for (let k = i; k < i + block; k += 4) s += data[k] * data[k];
    energy.push(s);
  }
  const span = Math.floor(seconds * 2);
  let sum = 0;
  for (let i = 0; i < span; i += 1) sum += energy[i];
  let best = 0;
  let bestSum = sum;
  for (let i = span; i < energy.length; i += 1) {
    sum += energy[i] - energy[i - span];
    if (sum > bestSum) {
      bestSum = sum;
      best = i - span + 1;
    }
  }
  return best / 2;
}

export async function decodeToMono(input, { maxSeconds = 30, signal } = {}) {
  const Ctx = Offline();
  if (!Ctx) throw new Error("This browser cannot decode audio offline");
  let decoded = input;
  if (!(typeof AudioBuffer !== "undefined" && input instanceof AudioBuffer)) {
    const bytes = await toArrayBuffer(input, signal);
    decoded = await new Ctx(1, 1, 44100).decodeAudioData(bytes);
  }
  const offset = loudestWindow(decoded.getChannelData(0), decoded.sampleRate, maxSeconds);
  const seconds = Math.min(maxSeconds, decoded.duration - offset);
  const ctx = new Ctx(1, Math.max(1, Math.ceil(seconds * RATE)), RATE);
  const src = ctx.createBufferSource();
  src.buffer = decoded;
  src.connect(ctx.destination);
  src.start(0, offset, seconds);
  const out = await ctx.startRendering();
  return { mono: out.getChannelData(0).slice(), offset, sourceDuration: decoded.duration };
}
