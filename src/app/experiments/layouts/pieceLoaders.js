"use client";

import { lazy } from "react";
import { LAB_PIECES } from "@/app/lab/pieces";

// One lazy chunk per piece. The index ships none of them up front: a tile
// pulls its own chunk when it comes near the viewport (see LivePiece).
export const LOADERS = {
  "/ink": () => import("@/app/ink/InkExperience"),
  "/refract": () => import("@/app/refract/RefractExperience"),
  "/halftone": () => import("@/app/halftone/HalftoneExperience"),
  "/backdrop": () => import("@/app/backdrop/BackdropExperience"),
  "/song-search": () => import("@/app/song-search/SongSearch"),
  "/deck": () => import("@/app/deck/Deck"),
  "/flyout": () => import("@/app/flyout/FlyoutExperience"),
  "/tuner": () => import("@/app/tuner/TunerExperience"),
  "/blobs": () => import("@/app/blobs/BlobPiece"),
  "/cover-ring": () => import("@/app/cover-ring/CoverRing"),
  "/ascii-cover": () => import("@/app/ascii-cover/AsciiCover"),
  "/wet-ink": () => import("@/app/wet-ink/WetInkExperience"),
  "/one-line": () => import("@/app/one-line/OneLineExperience"),
  "/counter": () => import("@/app/counter/CounterExperience"),
  "/taffy": () => import("@/app/taffy/TaffyExperience"),
  "/scorch": () => import("@/app/scorch/ScorchExperience"),
  "/stir": () => import("@/app/stir/StirExperience"),
  ...Object.fromEntries(Object.entries(LAB_PIECES).map(([slug, load]) => [`/lab/${slug}`, load])),
};

const LAZY = new Map();

export function lazyPiece(slug) {
  if (!LOADERS[slug]) return null;
  if (!LAZY.has(slug)) LAZY.set(slug, lazy(LOADERS[slug]));
  return LAZY.get(slug);
}

export function preloadPiece(slug) {
  return LOADERS[slug]?.().catch(() => null);
}
