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
  "/wet-ink": () => import("@/app/wet-ink/WetInkExperience"),
  "/one-line": () => import("@/app/one-line/OneLineExperience"),
  "/counter": () => import("@/app/counter/CounterExperience"),
  "/taffy": () => import("@/app/taffy/TaffyExperience"),
  "/scorch": () => import("@/app/scorch/ScorchExperience"),
  "/stir": () => import("@/app/stir/StirExperience"),
  ...Object.fromEntries(Object.entries(LAB_PIECES).map(([slug, load]) => [`/lab/${slug}`, load])),
};

// Pieces that mark their first real frame — `data-ready` or `data-painted`
// somewhere in their tree, set once their art has loaded and drawn. A tile
// keeps its poster up until then rather than lifting it off an empty canvas.
// The value is the marker to wait for: most pieces mark the element their art
// is revealed on, but a few mark their outer root as soon as the engine exists
// (it fades the caption in) and reveal the screen itself later, after a photo
// or a font has arrived — for those, only the screen's own mark counts. A few
// say it with their phase instead.
const ANY_MARK = '[data-ready]:not([data-ready="false"]), [data-painted]:not([data-painted="false"])';
const SCREEN_MARK = {
  amorph: '.amorph[data-phase="ready"]',
  crumple: '.crumple[data-status="ready"]',
  dandelion: '.dandelion[data-phase="ready"]',
  field: ".field-screen[data-ready]",
  kern: ".kern-surface[data-ready]",
  moire: ".moire-screen[data-ready]",
  scope: ".scope-screen[data-ready]",
  t9: ".t9-screen[data-ready]",
  terminal: ".terminal-screen[data-ready]",
};
export const READY_MARK = new Map([
  ...["/scorch", "/stir", "/taffy", "/counter", "/wet-ink", "/backdrop"].map((slug) => [slug, ANY_MARK]),
  // The plates mark the canvas their art is drawn on.
  ...["/ink", "/refract", "/halftone", "/blobs"].map((slug) => [slug, "canvas[data-painted]"]),
  ...["amorph", "ascii-bust", "blob-track", "crumple", "dandelion", "erase", "field", "film-leader", "focus-pull", "generation-loss", "ghost-setlist", "ink-drag", "iris", "justify", "kern", "light-table", "loupe", "mirrorball", "moire", "pull-vinyl", "raking-light", "refractor", "scope", "select", "smear", "split-flap", "steam", "sticker-peel", "t9", "terminal", "typewriter"].map((slug) => [`/lab/${slug}`, SCREEN_MARK[slug] ?? ANY_MARK]),
]);

const LAZY = new Map();
// A piece whose chunk has arrived, as the component itself. A tile mounts it
// directly rather than through lazy(): a lazy component suspends on its
// first render even when its module is already here, and React holds a
// revealed Suspense boundary back for a beat — time the tile would sit dead.
const RESOLVED = new Map();
const LOADING = new Map();

export function lazyPiece(slug) {
  if (!LOADERS[slug]) return null;
  if (!LAZY.has(slug)) LAZY.set(slug, lazy(LOADERS[slug]));
  return LAZY.get(slug);
}

export function resolvedPiece(slug) {
  return RESOLVED.get(slug) ?? null;
}

export function preloadPiece(slug) {
  if (!LOADERS[slug]) return Promise.resolve(null);
  if (!LOADING.has(slug)) {
    LOADING.set(
      slug,
      LOADERS[slug]()
        .then((module) => {
          if (module?.default) RESOLVED.set(slug, module.default);
          return module;
        })
        .catch(() => {
          // A failed fetch may succeed on the next approach.
          LOADING.delete(slug);
          return null;
        }),
    );
  }
  return LOADING.get(slug);
}
