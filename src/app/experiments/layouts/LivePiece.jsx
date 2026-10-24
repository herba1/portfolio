"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { preload } from "react-dom";
import PieceBoundary from "./PieceBoundary";
import { READY_MARK, lazyPiece, preloadPiece, resolvedPiece } from "./pieceLoaders";
import { enqueueTile, retain } from "./mountQueue";

// A tile arrives as its poster — a still of the piece, in the HTML — so the
// index paints whole on the first frame without a byte of piece code. The
// piece's chunk is fetched a few screens before the tile arrives, and the
// piece itself mounts behind the poster about a screen and a half out
// (through the mount queue), so by the time the tile is on screen it is
// already live underneath. The poster lifts the moment the piece has painted
// its first real frame, and at once if a visitor reaches for the tile first:
// a still is never left standing over a piece that already takes the hand.
// A mounted piece stays (pausing itself offscreen) until the queue needs its
// GPU context back for a nearer tile.

const WARM = "300% 0px";
const NEAR = "150% 0px";
// How long the poster may stay up once the tile is on screen, for a piece
// that paints without saying so, and for one that says so (it is waiting on
// its art). Both clocks run only while the tile is on screen.
const READY_TIMEOUT_MS = 600;
const MARKED_TIMEOUT_MS = 2500;
// Pieces mostly fade their art in once drawn. The poster waits a moment for
// that reveal, so it doesn't crossfade into a blank tile, but no longer.
const REVEAL_CAP_MS = 320;

function revealing(box) {
  return box.getAnimations({ subtree: true }).some((animation) => {
    if (animation.playState !== "running") return false;
    return Number.isFinite(animation.effect?.getComputedTiming().endTime);
  });
}

function painted(box, mark) {
  if (box.querySelector("[data-plate]")) return Boolean(box.querySelector("canvas[data-painted]"));
  if (mark) return Boolean(box.querySelector(mark));
  // Nothing but the poster yet: the piece has not rendered at all.
  if (box.childElementCount < 2) return false;
  const canvas = box.querySelector("canvas");
  if (canvas && !canvas.width) return false;
  return [...box.querySelectorAll("img")].every((image) => image.complete);
}

// Below this width the bento stacks every tile at 4:5 (layouts.css), and the
// tile shows its narrow still: a phone crop of the desktop still is a
// different picture from the one the piece paints there.
const NARROW = "(max-width: 899px)";
const WIDE = "(min-width: 900px)";

function preloadPoster(poster, priority) {
  if (!poster.narrow) {
    preload(poster.src, { as: "image", fetchPriority: "high", media: priority });
    return;
  }
  if (priority === "all" || priority === NARROW) preload(poster.narrow.src, { as: "image", fetchPriority: "high", media: NARROW });
  if (priority === "all" || priority === WIDE) preload(poster.src, { as: "image", fetchPriority: "high", media: WIDE });
}

// `priority` is the media query under which this tile is in the first screen
// (the bento and the phone stack put different tiles there), or null. Its
// poster is preloaded for that query only, so a phone never spends its first
// second of bandwidth on stills from the desktop's top row.
export default function LivePiece({ slug, data, poster, priority = null, title }) {
  if (poster && priority) preloadPoster(poster, priority);
  // A first-screen tile fetches its chunk as the page hydrates. The mount
  // queue only hears of it from an effect, once all of hydration is done —
  // on a phone that was most of a second with the network sitting idle.
  if (priority && typeof window !== "undefined" && (priority === "all" || window.matchMedia(priority).matches)) {
    preloadPiece(slug);
  }
  const boxRef = useRef(null);
  // The component once it is this tile's turn, or null.
  const [mounted, setMounted] = useState(null);
  // Within a screen and a half of the viewport.
  const [near, setNear] = useState(false);
  // The piece has drawn its first real frame, and the poster has lifted.
  const [live, setLive] = useState(false);
  const known = Boolean(lazyPiece(slug));

  useEffect(() => {
    const box = boxRef.current;
    if (!box || !known) return undefined;
    const tile = box.closest(".xl-tile") ?? box;
    let isNear = false;
    let release = null;

    const handle = enqueueTile(
      box,
      () => preloadPiece(slug),
      () => {
        release = retain(box, evict);
        setMounted(() => resolvedPiece(slug) ?? lazyPiece(slug));
      },
    );
    function evict() {
      release = null;
      handle.released();
      setLive(false);
      setMounted(null);
      // Still within reach: back in line for when it comes nearer.
      if (isNear) handle.mount();
    }

    const warm = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) handle.warm();
        else if (!release) handle.cancel();
      },
      { rootMargin: WARM },
    );
    const reach = new IntersectionObserver(
      ([entry]) => {
        isNear = entry.isIntersecting;
        setNear(isNear);
        if (release) return;
        if (isNear) handle.mount();
        else handle.unmount();
      },
      { rootMargin: NEAR },
    );
    warm.observe(box);
    reach.observe(box);

    // A hand on a tile whose piece is not up yet puts it first in line, for
    // the network and the main thread both.
    const reachFor = (event) => {
      if (!event.isTrusted || release) return;
      handle.urgent();
    };
    tile.addEventListener("pointerenter", reachFor, { passive: true });
    tile.addEventListener("pointerdown", reachFor, { passive: true, capture: true });
    tile.addEventListener("focusin", reachFor);
    return () => {
      warm.disconnect();
      reach.disconnect();
      tile.removeEventListener("pointerenter", reachFor);
      tile.removeEventListener("pointerdown", reachFor, { capture: true });
      tile.removeEventListener("focusin", reachFor);
      handle.cancel();
      release?.();
    };
  }, [slug, known]);

  // A tile renders in full (layouts.css) only while its piece is coming up
  // near the viewport: long enough for a piece mounted ahead of the scroll to
  // measure its box and draw its first frame offscreen. Once it has, the tile
  // goes back to skipping its rendering whenever it is out of sight, so a
  // piece that keeps drawing offscreen costs nothing there.
  useEffect(() => {
    const tile = boxRef.current?.closest(".xl-tile");
    if (!tile) return undefined;
    tile.toggleAttribute("data-near", near && !live);
    return () => tile.removeAttribute("data-near");
  }, [near, live]);

  // Watch for the piece's first real frame. Mounted ahead of the scroll, it
  // usually draws while still offscreen, and the poster lifts there, unseen:
  // the tile arrives already live, with no swap to watch. On screen the check
  // runs every frame, and gives up waiting after a short cap; offscreen it
  // runs a few times a second, and never gives up on its own.
  useEffect(() => {
    if (!mounted) return undefined;
    const box = boxRef.current;
    const tile = box.closest(".xl-tile") ?? box;
    const mark = READY_MARK.get(slug);
    const cap = () => (mark || box.querySelector("[data-plate]") ? MARKED_TIMEOUT_MS : READY_TIMEOUT_MS);
    let onScreen = false;
    let waited = 0;
    let markedAt = 0;
    let last = 0;
    let frame = 0;
    let timer = 0;
    let done = false;
    const lift = () => {
      if (done) return;
      done = true;
      stop();
      setLive(true);
    };
    // The piece is already taking the hand underneath; let it be seen.
    const onHand = (event) => {
      if (event.isTrusted) lift();
    };
    const check = () => {
      frame = 0;
      timer = 0;
      const now = performance.now();
      if (onScreen) waited += last ? now - last : 0;
      last = now;
      let ready = waited > cap();
      if (!ready && painted(box, mark)) {
        markedAt ||= now;
        ready = !revealing(box) || now - markedAt > REVEAL_CAP_MS;
      }
      if (ready) lift();
      else next();
    };
    const next = () => {
      if (frame || timer || done) return;
      if (onScreen) frame = requestAnimationFrame(check);
      else timer = setTimeout(check, 160);
    };
    const observer = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
      last = 0;
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      frame = 0;
      timer = 0;
      next();
    });
    function stop() {
      observer.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(timer);
      tile.removeEventListener("pointerdown", onHand, { capture: true });
      tile.removeEventListener("pointermove", onHand, { capture: true });
      tile.removeEventListener("keydown", onHand, { capture: true });
    }
    observer.observe(box);
    tile.addEventListener("pointerdown", onHand, { passive: true, capture: true });
    tile.addEventListener("pointermove", onHand, { passive: true, capture: true });
    tile.addEventListener("keydown", onHand, { capture: true });
    return stop;
  }, [mounted, slug]);

  const Component = mounted;
  return (
    <div ref={boxRef} className="xl-live" data-live={live || (mounted && !poster) ? "" : undefined}>
      {Component ? (
        <PieceBoundary slug={slug}>
          <Suspense fallback={null}>
            <Component embedded {...(data ?? {})} />
          </Suspense>
        </PieceBoundary>
      ) : null}
      {poster ? (
        <picture>
          {poster.narrow ? (
            <source media={NARROW} srcSet={poster.narrow.src} width={poster.narrow.width} height={poster.narrow.height} />
          ) : null}
          <img
            className="xl-live__poster"
            src={poster.src}
            width={poster.width}
            height={poster.height}
            alt={title ? `${title}, a still` : ""}
            decoding="async"
            loading={priority ? "eager" : "lazy"}
            fetchPriority={priority ? "auto" : "low"}
            draggable={false}
          />
        </picture>
      ) : (
        <div className="xl-live__poster xl-live__poster--blank" aria-hidden="true" />
      )}
    </div>
  );
}
