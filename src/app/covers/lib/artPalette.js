"use client";

import { useEffect, useState } from "react";
import { coverLoaded, getCoverTexture } from "./makeCovers";

const SAMPLE = 48;
const BUCKET_BITS = 4;
const PALETTE_SIZE = 10;
const MIN_SHARE = 0.01;
const FALLBACK_MIN_SHARE = 0.001;
const READABLE_CONTRAST = 7;
const TEXTURE_RETRY_MS = 120;
const TEXTURE_RETRIES = 16;

const cache = new Map();

function toLinear(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

function luminance([r, g, b]) {
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

function contrast(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

function toHex([r, g, b]) {
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

function extractPalette(source) {
  const canvas = document.createElement("canvas");
  canvas.width = SAMPLE;
  canvas.height = SAMPLE;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  g.drawImage(source, 0, 0, SAMPLE, SAMPLE);
  const d = g.getImageData(0, 0, SAMPLE, SAMPLE).data;

  const shift = 8 - BUCKET_BITS;
  const buckets = new Map();
  let pixels = 0;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i + 3] < 255) continue;
    pixels += 1;
    const r = d[i];
    const gr = d[i + 1];
    const b = d[i + 2];
    const bucketKey = ((r >> shift) << (BUCKET_BITS * 2)) | ((gr >> shift) << BUCKET_BITS) | (b >> shift);
    let bucket = buckets.get(bucketKey);
    if (!bucket) {
      bucket = { count: 0, exact: new Map() };
      buckets.set(bucketKey, bucket);
    }
    bucket.count += 1;
    const exactKey = (r << 16) | (gr << 8) | b;
    bucket.exact.set(exactKey, (bucket.exact.get(exactKey) || 0) + 1);
  }

  return [...buckets.values()]
    .filter((bucket) => bucket.count / pixels >= FALLBACK_MIN_SHARE)
    .sort((a, b) => b.count - a.count)
    .map((bucket) => {
      let topKey = 0;
      let topCount = -1;
      for (const [key, count] of bucket.exact) {
        if (count > topCount) {
          topKey = key;
          topCount = count;
        }
      }
      return { rgb: [(topKey >> 16) & 255, (topKey >> 8) & 255, topKey & 255], share: bucket.count / pixels };
    });
}

function bestTextFor(bg, candidates) {
  let best = null;
  for (const fg of candidates) {
    if (fg === bg || luminance(fg.rgb) <= luminance(bg.rgb)) continue;
    const ratio = contrast(bg.rgb, fg.rgb);
    if (!best || ratio > best.ratio) best = { bg, fg, ratio };
  }
  return best;
}

function pickInkPair(fills, texts) {
  let strongest = null;
  for (const bg of fills) {
    const pair = bestTextFor(bg, texts);
    if (!pair) continue;
    if (pair.ratio >= READABLE_CONTRAST) return pair;
    if (!strongest || pair.ratio > strongest.ratio) strongest = pair;
  }
  return strongest;
}

function inkFromSource(source) {
  const all = extractPalette(source);
  const palette = all.filter((swatch) => swatch.share >= MIN_SHARE).slice(0, PALETTE_SIZE);
  const common = pickInkPair(palette, all);
  const pair = common && common.ratio >= READABLE_CONTRAST ? common : pickInkPair(all, all) || common;
  if (!pair) return null;
  return {
    bg: toHex(pair.bg.rgb),
    fg: toHex(pair.fg.rgb),
    ratio: pair.ratio,
    swatches: [...new Set([...palette, pair.bg, pair.fg].map((swatch) => toHex(swatch.rgb)))],
  };
}

function readTexture(index) {
  if (index == null || !coverLoaded(index)) return null;
  const source = getCoverTexture(index)?.image;
  return source?.width ? source : null;
}

export function useArtPalette(url, index = null) {
  const [result, setResult] = useState(() => cache.get(url) || null);

  useEffect(() => {
    if (!url) return;
    const hit = cache.get(url);
    if (hit) {
      setResult(hit);
      return;
    }
    let alive = true;
    let retry = null;
    let img = null;

    const settle = (source) => {
      try {
        const next = inkFromSource(source);
        if (!next) return;
        cache.set(url, next);
        if (alive) setResult(next);
      } catch {
        if (alive) setResult(null);
      }
    };

    const loadFromUrl = () => {
      img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => settle(img);
      img.src = url;
    };

    const texture = readTexture(index);
    if (texture) {
      settle(texture);
    } else if (index == null) {
      loadFromUrl();
    } else {
      let tries = 0;
      retry = setInterval(() => {
        const ready = readTexture(index);
        if (ready || ++tries > TEXTURE_RETRIES) {
          clearInterval(retry);
          retry = null;
          if (ready) settle(ready);
          else loadFromUrl();
        }
      }, TEXTURE_RETRY_MS);
    }

    return () => {
      alive = false;
      if (retry) clearInterval(retry);
      if (img) img.onload = null;
    };
  }, [url, index]);

  return result;
}
