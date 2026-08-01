"use client";

/* ─────────────────────────────────────────────────────────────────────────
   warmImages — every card scan fetched AND decoded once, up front.

   Filter and tab switches remount tiles, so each switch builds fresh <img>
   elements. An HTTP cache hit alone is not enough there: the browser still
   has to decode the JPEG, and with decoding="async" that lands a frame or
   two late, which reads as a flash.

   So we do two things and hold both forever:
     · fetch — a detached Image() per src, warming the HTTP cache
     · decode — await img.decode(), and keep the element referenced in the
       module-level map so the decoded bitmap is not evicted

   Once a src is warm, Slab renders it with decoding="sync": the pixels are
   already there, so painting them costs nothing and the swap is same-frame.

   Twelve scans, ~1.5MB total. Small enough to just take all of it at mount
   rather than pay for it piecemeal on every interaction.
   ───────────────────────────────────────────────────────────────────────── */

// src → HTMLImageElement. Never cleared; that is the point.
const held = new Map();
const warm = new Set();
const listeners = new Set();

/* Whether a src is warm is a CLIENT-ONLY fact that changes at an arbitrary
   moment — a decode can land in the middle of hydration. So it is exposed as
   a subscribable store rather than a bare getter: consumers read it through
   useSyncExternalStore, which is the one API that can hand hydration a
   server-shaped answer and the flip afterwards. Reading `warm` directly in a
   render body is what produced a hydration mismatch. */
export function isWarm(src) {
  return warm.has(src);
}

export function subscribeWarm(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function markWarm(src) {
  if (warm.has(src)) return;
  warm.add(src);
  for (const fn of listeners) fn();
}

/** Fetch + decode one src. Idempotent. Call it from an effect, not a render. */
export function warmImage(src) {
  if (!src || typeof window === "undefined" || held.has(src)) return;

  const img = new Image();
  held.set(src, img);
  img.decoding = "async";
  // Card scans are the content of the page, not decoration — ask for them
  // ahead of anything else the browser might be idling on.
  img.fetchPriority = "high";
  img.src = src;

  const done = () => markWarm(src);
  if (img.decode) img.decode().then(done, done);
  else img.onload = done;
}

/** Warm a whole list. Call once with every image the surface can ever show. */
export function warmImages(sources) {
  for (const src of sources) warmImage(src);
}
