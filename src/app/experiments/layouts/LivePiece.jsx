"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { preload } from "react-dom";
import PieceBoundary from "./PieceBoundary";
import { lazyPiece, preloadPiece } from "./pieceLoaders";
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

function painted(box) {
  if (box.querySelector("[data-plate]")) return Boolean(box.querySelector("canvas[data-painted]"));
  const canvas = box.querySelector("canvas");
  if (canvas && !canvas.width) return false;
  return [...box.querySelectorAll("img")].every((image) => image.complete);
}

// `priority` is the media query under which this tile is in the first screen
// (the bento and the phone stack put different tiles there), or null. Its
// poster is preloaded for that query only, so a phone never spends its first
// second of bandwidth on stills from the desktop's top row.
export default function LivePiece({ slug, data, poster, priority = null, title }) {
  if (poster && priority) preload(poster.src, { as: "image", fetchPriority: "high", media: priority });
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
    const started = performance.now();
    let frame = 0;
    let settleFrames = 2;
    const check = () => {
      if (painted(box) || performance.now() - started > READY_TIMEOUT_MS) {
        settleFrames -= 1;
        if (settleFrames <= 0) {
          setLive(true);
          return;
        }
      }
      frame = requestAnimationFrame(check);
    };
    frame = requestAnimationFrame(check);
    return () => cancelAnimationFrame(frame);
  }, [mounted]);

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
        // eslint-disable-next-line @next/next/no-img-element
        <img
          className="xl-live__poster"
          src={poster.src}
          width={poster.width}
          height={poster.height}
          alt={title ? `${title}, a still` : ""}
          decoding="async"
          loading="lazy"
          fetchPriority={priority ? "auto" : "low"}
          draggable={false}
        />
      ) : (
        <div className="xl-live__poster xl-live__poster--blank" aria-hidden="true" />
      )}
    </div>
  );
}
