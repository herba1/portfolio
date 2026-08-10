"use client";

import { useEffect, useState } from "react";

const BUCKETS_PER_SEC = 1000;

function reduce(buffer) {
  const data = buffer.getChannelData(0);
  const size = Math.max(1, Math.round(buffer.sampleRate / BUCKETS_PER_SEC));
  const count = Math.floor(data.length / size);
  const out = new Float32Array(count);
  let ceiling = 0;
  for (let i = 0; i < count; i++) {
    let peak = 0;
    const start = i * size;
    for (let j = 0; j < size; j++) {
      const v = Math.abs(data[start + j]);
      if (v > peak) peak = v;
    }
    out[i] = peak;
    if (peak > ceiling) ceiling = peak;
  }
  if (ceiling > 0) for (let i = 0; i < count; i++) out[i] /= ceiling;
  return { data: out, rate: BUCKETS_PER_SEC, durationMs: buffer.duration * 1000 };
}

export function usePeaks(sources) {
  const [peaks, setPeaks] = useState(null);

  useEffect(() => {
    let alive = true;
    const Ctx = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
    if (!Ctx) return;
    const ctx = new Ctx();

    (async () => {
      for (const src of sources) {
        try {
          const res = await fetch(src);
          if (!res.ok) continue;
          const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
          if (!alive) return;
          setPeaks(reduce(buffer));
          break;
        } catch {
          continue;
        }
      }
      ctx.close();
    })();

    return () => {
      alive = false;
    };
  }, [sources]);

  return peaks;
}

export function amplitudeAt(peaks, ms) {
  if (!peaks) return 0;
  const i = Math.round((ms / 1000) * peaks.rate);
  if (i < 0 || i >= peaks.data.length) return 0;
  let sum = 0;
  let n = 0;
  for (let j = Math.max(0, i - 25); j < Math.min(peaks.data.length, i + 25); j++) {
    sum += peaks.data[j];
    n++;
  }
  return n ? sum / n : 0;
}
