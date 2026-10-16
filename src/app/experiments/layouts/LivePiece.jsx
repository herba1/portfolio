"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import PieceBoundary from "./PieceBoundary";
import { lazyPiece, preloadPiece } from "./pieceLoaders";
import { enqueueMount, runWhenIdle } from "./mountQueue";

// A tile arrives as its poster — a still of the piece, in the HTML — so the
// index paints whole on the first frame without a byte of piece code. The
// live piece mounts behind the poster once the tile nears the viewport
// (through the mount queue, one per idle slot), and the poster lifts off
// only after the piece has painted. Far offscreen the piece unmounts again,
// which frees its GPU context and stops its frame loop for good.

const NEAR = "60% 0px";
const FAR = "180% 0px";
const READY_TIMEOUT_MS = 1400;
const UNMOUNT_AFTER_MS = 1200;

function painted(box) {
  if (box.querySelector("[data-plate]")) return Boolean(box.querySelector("canvas[data-painted]"));
  const canvas = box.querySelector("canvas");
  if (canvas && !canvas.width) return false;
  return [...box.querySelectorAll("img")].every((image) => image.complete);
}

export default function LivePiece({ slug, data, poster, priority = false, title }) {
  const boxRef = useRef(null);
  const [mounted, setMounted] = useState(false);
  const [live, setLive] = useState(false);
  const Component = lazyPiece(slug);

  useEffect(() => {
    const box = boxRef.current;
    if (!box || !Component) return undefined;
    let cancelJob = null;
    let unmountTimer = 0;
    let cancelIdle = null;

    const near = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        clearTimeout(unmountTimer);
        cancelIdle?.();
        if (cancelJob) return;
        cancelJob = enqueueMount(
          box,
          () => preloadPiece(slug),
          () => setMounted(true),
        );
      },
      { rootMargin: NEAR },
    );
    const far = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) return;
        clearTimeout(unmountTimer);
        unmountTimer = setTimeout(() => {
          cancelIdle = runWhenIdle(() => {
            cancelJob?.();
            cancelJob = null;
            setLive(false);
            setMounted(false);
          });
        }, UNMOUNT_AFTER_MS);
      },
      { rootMargin: FAR },
    );
    near.observe(box);
    far.observe(box);
    return () => {
      near.disconnect();
      far.disconnect();
      clearTimeout(unmountTimer);
      cancelIdle?.();
      cancelJob?.();
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
          loading={priority ? "eager" : "lazy"}
          fetchPriority={priority ? "high" : "low"}
          draggable={false}
        />
      ) : (
        <div className="xl-live__poster xl-live__poster--blank" aria-hidden="true" />
      )}
    </div>
  );
}
