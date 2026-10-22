"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { preload } from "react-dom";
import PieceBoundary from "./PieceBoundary";
import { READY_MARK, lazyPiece, preloadPiece } from "./pieceLoaders";
import { enqueueMount, retain } from "./mountQueue";

// A tile arrives as its poster — a still of the piece, in the HTML — so the
// index paints whole on the first frame without a byte of piece code. The
// live piece mounts behind the poster once the tile nears the viewport
// (through the mount queue, one per idle slot), and the poster lifts off
// only after the piece has painted. A tile that leaves before its turn never
// mounts. A mounted piece stays (pausing itself offscreen) until the queue
// needs its GPU context back for a nearer tile.

const NEAR = "60% 0px";
const READY_TIMEOUT_MS = 1400;
// A piece that says when its first real frame is up waits for that instead,
// however long its art takes to arrive; the cap only covers a piece that
// never says so. Both clocks run only while the tile is on screen: a piece
// mounted just below the fold may not start until it is scrolled to.
const MARKED_TIMEOUT_MS = 8000;
// Pieces mostly fade their art in once drawn. The poster waits for that
// reveal to finish, or it would crossfade into a half-drawn tile.
const REVEAL_CAP_MS = 1500;

function revealing(box) {
  return box.getAnimations({ subtree: true }).some((animation) => {
    if (animation.playState !== "running") return false;
    return Number.isFinite(animation.effect?.getComputedTiming().endTime);
  });
}

function painted(box, mark) {
  if (box.querySelector("[data-plate]")) return Boolean(box.querySelector("canvas[data-painted]"));
  if (mark) return Boolean(box.querySelector(mark));
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
  const [mounted, setMounted] = useState(false);
  const [live, setLive] = useState(false);
  const Component = lazyPiece(slug);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || !Component) return undefined;
    let near = false;
    let cancelJob = null;
    let release = null;

    const evict = () => {
      release = null;
      setLive(false);
      setMounted(false);
    };
    const observer = new IntersectionObserver(
      ([entry]) => {
        near = entry.isIntersecting;
        if (!near) {
          cancelJob?.();
          cancelJob = null;
          return;
        }
        if (cancelJob || release) return;
        cancelJob = enqueueMount(
          box,
          () => preloadPiece(slug),
          () => {
            cancelJob = null;
            release = retain(box, () => near, evict);
            setMounted(true);
          },
        );
      },
      { rootMargin: NEAR },
    );
    observer.observe(box);
    return () => {
      observer.disconnect();
      cancelJob?.();
      release?.();
    };
  }, [slug, Component]);

  useEffect(() => {
    if (!mounted) return undefined;
    const box = boxRef.current;
    // A tile with no still has nothing to hold over the piece: show it as it
    // draws.
    if (!poster) {
      setLive(true);
      return undefined;
    }
    const mark = READY_MARK.get(slug);
    // A plate marks its painted canvas, so it gets a marked piece's patience.
    const cap = () => (mark || box.querySelector("[data-plate]") ? MARKED_TIMEOUT_MS : READY_TIMEOUT_MS);
    let onScreen = false;
    const observer = new IntersectionObserver(([entry]) => {
      onScreen = entry.isIntersecting;
    });
    observer.observe(box);
    let waited = 0;
    let markedAt = 0;
    let last = performance.now();
    let frame = 0;
    let settleFrames = 2;
    const check = (now) => {
      if (onScreen) waited += now - last;
      last = now;
      let done = waited > cap();
      if (!done && painted(box, mark)) {
        markedAt ||= now;
        done = !revealing(box) || now - markedAt > REVEAL_CAP_MS;
      }
      if (done) {
        settleFrames -= 1;
        if (settleFrames <= 0) {
          observer.disconnect();
          setLive(true);
          return;
        }
      }
      frame = requestAnimationFrame(check);
    };
    frame = requestAnimationFrame(check);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [mounted, slug, poster]);

  return (
    <div ref={boxRef} className="xl-live" data-live={live ? "" : undefined}>
      {mounted && Component ? (
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
