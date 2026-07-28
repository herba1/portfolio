"use client";

import { useEffect, useState } from "react";
import { coverLoaded, getCoverTexture } from "./makeCovers";

// ---------------------------------------------------------------------------
// Picks black or white for anything drawn on top of album art, by measuring the
// corner it actually sits in.
//
// The cheap part is where the pixels come from. The grid has already decoded
// every cover and painted it into a 2D canvas to feed its WebGL texture, and a
// CanvasTexture keeps that canvas on `tex.image` — so this reads pixels that are
// already in memory. No second fetch, no second decode, no <img> at all. (It
// would otherwise cost a duplicate request: a crossOrigin load is a separate
// cache entry from a plain one, so "just re-download it, the browser has it"
// is not actually true.)
//
// Per track that leaves: one drawImage that scales the corner down to 8×8 (the
// GPU does the averaging) and one 64-pixel readback. Cached by URL, so covers
// that repeat across the infinite grid are measured once.
// ---------------------------------------------------------------------------

const N = 8; // sample grid — 64 pixels is plenty for an average
const REGION = 0.26; // fraction of the art, from the bottom-right corner
// Where the two candidates tie on WCAG contrast. Derived, not guessed: setting
// (L+0.05)/(Link+0.05) == 1.05/(L+0.05) gives L = √(1.05·(Link+0.05)) − 0.05.
//
// Note it's computed from the REAL ink, not from pure black. --color-ink is
// #0e0f11, and using black's 0.179 instead of this 0.189 hands the wrong colour
// to everything that lands in the gap between them.
const INK_LUM = 0.004755; // #0e0f11 in linear light
const BREAK_EVEN = Math.sqrt(1.05 * (INK_LUM + 0.05)) - 0.05;

const cache = new Map(); // image url → "ink" | "paper"
let sampler = null; // one shared 8×8 canvas for the whole app

function toLinear(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** "ink" (near-black) or "paper" (white) for the art's bottom-right corner. */
export function sampleCornerInk(index, url) {
  if (!url || typeof document === "undefined") return null;
  const hit = cache.get(url);
  if (hit) return hit;
  if (!coverLoaded(index)) return null; // still decoding in the grid

  const src = getCoverTexture(index)?.image;
  if (!src?.width) return null;

  try {
    if (!sampler) {
      sampler = document.createElement("canvas");
      sampler.width = N;
      sampler.height = N;
    }
    const g = sampler.getContext("2d", { willReadFrequently: true });
    const w = src.width * REGION;
    const h = src.height * REGION;
    g.drawImage(src, src.width - w, src.height - h, w, h, 0, 0, N, N);

    const d = g.getImageData(0, 0, N, N).data;
    let sum = 0;
    for (let i = 0; i < d.length; i += 4) {
      // relative luminance, in linear light — averaging sRGB bytes directly
      // would read a dark corner as brighter than it is
      sum += 0.2126 * toLinear(d[i]) + 0.7152 * toLinear(d[i + 1]) + 0.0722 * toLinear(d[i + 2]);
    }
    const lum = sum / (d.length / 4);
    const ink = lum > BREAK_EVEN ? "ink" : "paper";
    cache.set(url, ink);
    return ink;
  } catch {
    return null; // tainted canvas or no 2d context — caller just won't paint
  }
}

/**
 * null until the art has painted. Callers render nothing while it's null, which
 * is a frame or two at most — the cover was already on screen to be clicked.
 */
export function useArtInk(index, url) {
  const [ink, setInk] = useState(null);

  useEffect(() => {
    const now = sampleCornerInk(index, url);
    setInk(now);
    if (now || !url) return;

    // Opened before its art finished decoding — check back briefly, then let it go.
    let tries = 0;
    const id = setInterval(() => {
      const v = sampleCornerInk(index, url);
      if (v || ++tries > 16) {
        clearInterval(id);
        if (v) setInk(v);
      }
    }, 120);
    return () => clearInterval(id);
  }, [index, url]);

  return ink;
}
