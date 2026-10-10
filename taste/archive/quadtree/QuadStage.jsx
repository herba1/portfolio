"use client";

import { useEffect, useRef, useState } from "react";

import { haptic } from "@/lib/haptics";

import QuadField from "./QuadField";
import { createCoverLibrary } from "./coverLibrary";

const TAP_SLOP_PX = 6;
const TAP_MS = 240;
const HOLD_MS = 380;
const MOUSE_HOLD_MS = 240;
const COMPACT_PX = 520;
const LENS_MIN = 0.08;
const LENS_MAX = 0.4;
const LENS_RESYNC = 0.006;
const SIZING_MS = 700;

function localPoint(element, event) {
  const rect = element.getBoundingClientRect();
  return {
    x: (event.clientX - rect.left) / rect.width,
    y: (event.clientY - rect.top) / rect.height,
    px: event.clientX - rect.left,
    py: event.clientY - rect.top,
  };
}

export default function QuadStage({
  entry,
  upcoming,
  params,
  embedded,
  reducedMotion,
  originRef,
  onStats,
  onShown,
  onFail,
  onNext,
  onPrevious,
  onLens,
  captureRef,
  releaseRef,
}) {
  const coverRef = useRef(null);
  const canvasHostRef = useRef(null);
  const lensRef = useRef(null);
  const ringRef = useRef(null);
  const fieldRef = useRef(null);
  const pressRef = useRef(null);
  const holdRef = useRef(0);
  const statsRef = useRef(onStats);
  const onLensRef = useRef(onLens);
  const liveLensRef = useRef(params.lens);
  const sizingRef = useRef(false);
  const [library] = useState(createCoverLibrary);

  useEffect(() => {
    statsRef.current = onStats;
    onLensRef.current = onLens;
    if (!sizingRef.current && Math.abs(params.lens - liveLensRef.current) > LENS_RESYNC) liveLensRef.current = params.lens;
  }, [onStats, onLens, params.lens]);

  useEffect(() => {
    const host = canvasHostRef.current;
    const cover = coverRef.current;
    if (!host || !cover) return undefined;
    const canvas = document.createElement("canvas");
    canvas.className = "qt-canvas";
    host.appendChild(canvas);
    const compact = cover.clientWidth < COMPACT_PX;
    if (compact) cover.setAttribute("data-compact", "");
    const dprCap = embedded || compact ? 1.5 : 2;
    const field = new QuadField(canvas, {
      ring: ringRef.current,
      lens: lensRef.current,
      cover,
      compact,
      onStats: (tiles, carved) => statsRef.current?.(tiles, carved),
      onReady: () => cover.setAttribute("data-ready", ""),
    });
    fieldRef.current = field;
    if (!field.usesWebGL) cover.setAttribute("data-flat", "");
    field.resize(cover.clientWidth, dprCap);

    let onscreen = true;
    const sync = () => field.setActive(onscreen && !document.hidden);
    const resizeObserver = new ResizeObserver(() => field.resize(cover.clientWidth, dprCap));
    resizeObserver.observe(cover);
    const intersection = new IntersectionObserver(([record]) => {
      onscreen = record.isIntersecting;
      sync();
    });
    intersection.observe(cover);
    document.addEventListener("visibilitychange", sync);
    sync();

    let sizingTimer = 0;
    const handleWheel = (event) => {
      if (embedded) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 100 / 6 : event.deltaMode === 2 ? cover.clientHeight : 1;
      const next = Math.min(LENS_MAX, Math.max(LENS_MIN, liveLensRef.current * Math.exp(-event.deltaY * unit * 0.0016)));
      if (next === liveLensRef.current) return;
      liveLensRef.current = next;
      sizingRef.current = true;
      onLensRef.current?.(next);
      cover.setAttribute("data-sizing", "");
      window.clearTimeout(sizingTimer);
      sizingTimer = window.setTimeout(() => {
        sizingRef.current = false;
        cover.removeAttribute("data-sizing");
      }, SIZING_MS);
    };
    cover.addEventListener("wheel", handleWheel, { passive: false });

    captureRef.current = () => field.capture();
    releaseRef.current = () => field.releaseCarve();

    return () => {
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", sync);
      cover.removeEventListener("wheel", handleWheel);
      window.clearTimeout(sizingTimer);
      window.clearTimeout(holdRef.current);
      sizingRef.current = false;
      captureRef.current = null;
      releaseRef.current = null;
      field.destroy();
      field.canvas.remove();
      canvas.remove();
      fieldRef.current = null;
    };
  }, [embedded, captureRef, releaseRef]);

  useEffect(() => () => library.dispose(), [library]);

  useEffect(() => {
    fieldRef.current?.setReduced(reducedMotion);
  }, [reducedMotion]);

  useEffect(() => {
    fieldRef.current?.setParams(params);
  }, [params]);

  useEffect(() => {
    if (!entry) return undefined;
    let alive = true;
    library
      .get(entry.image)
      .then((source) => {
        if (!alive) return;
        const field = fieldRef.current;
        if (!field) return;
        const origin = originRef.current;
        field.setCover(source, origin.x, origin.y);
        onShown(entry);
        if (upcoming) library.prefetch(upcoming.image);
      })
      .catch(() => {
        if (alive) onFail(entry);
      });
    return () => {
      alive = false;
    };
  }, [entry, upcoming, library, originRef, onShown, onFail]);

  const placeRing = (point) => {
    const lens = lensRef.current;
    if (lens) lens.style.transform = `translate3d(${point.px}px, ${point.py}px, 0)`;
  };

  const handlePointerMove = (event) => {
    const cover = coverRef.current;
    const field = fieldRef.current;
    if (!cover || !field) return;
    const point = localPoint(cover, event);
    const press = pressRef.current;
    if (press && press.id === event.pointerId) {
      const dx = event.clientX - press.clientX;
      const dy = event.clientY - press.clientY;
      if (!press.moved && dx * dx + dy * dy > TAP_SLOP_PX * TAP_SLOP_PX) {
        press.moved = true;
        window.clearTimeout(holdRef.current);
        if (!press.touch && !press.carving) startCarve(press);
      }
    }
    if (event.pointerType === "touch" && !press) return;
    field.setPointer(point.x, point.y);
    placeRing(point);
  };

  const handlePointerEnter = (event) => {
    if (event.pointerType === "touch") return;
    const cover = coverRef.current;
    const field = fieldRef.current;
    if (!cover || !field) return;
    const point = localPoint(cover, event);
    field.setPointer(point.x, point.y);
    field.setInside(true);
    placeRing(point);
    cover.setAttribute("data-lens", "");
  };

  const handlePointerLeave = (event) => {
    if (event.pointerType === "touch" || pressRef.current) return;
    fieldRef.current?.setInside(false);
    coverRef.current?.removeAttribute("data-lens");
  };

  const startCarve = (press) => {
    press.carving = true;
    fieldRef.current?.setPressed(true);
    coverRef.current?.setAttribute("data-carving", "");
  };

  const handlePointerDown = (event) => {
    if (event.button !== 0) return;
    const cover = coverRef.current;
    const field = fieldRef.current;
    if (!cover || !field) return;
    const point = localPoint(cover, event);
    if (event.pointerType !== "touch") cover.setPointerCapture(event.pointerId);
    pressRef.current = {
      id: event.pointerId,
      clientX: event.clientX,
      clientY: event.clientY,
      startedAt: event.timeStamp,
      moved: false,
      carving: false,
      touch: event.pointerType === "touch",
      x: point.x,
      y: point.y,
    };
    field.setPointer(point.x, point.y);
    field.setInside(true);
    placeRing(point);
    cover.setAttribute("data-lens", "");
    const touch = event.pointerType === "touch";
    window.clearTimeout(holdRef.current);
    holdRef.current = window.setTimeout(
      () => {
        const current = pressRef.current;
        if (!current || current.carving || (touch && current.moved)) return;
        startCarve(current);
        if (touch) haptic("press");
      },
      touch ? HOLD_MS : MOUSE_HOLD_MS,
    );
  };

  const finishPress = (event, cancelled) => {
    const press = pressRef.current;
    if (!press || press.id !== event.pointerId) return;
    pressRef.current = null;
    window.clearTimeout(holdRef.current);
    const cover = coverRef.current;
    const field = fieldRef.current;
    field?.setPressed(false);
    cover?.removeAttribute("data-carving");
    const tapped = !cancelled && !press.moved && !press.carving && event.timeStamp - press.startedAt < TAP_MS;
    if (press.touch || cancelled) {
      field?.setInside(false);
      cover?.removeAttribute("data-lens");
    }
    if (tapped) {
      originRef.current = { x: press.x, y: press.y };
      haptic("tick");
      onNext();
    }
  };

  const handleKeyDown = (event) => {
    if (event.key === "ArrowRight" || event.key === " " || event.key === "Enter") {
      event.preventDefault();
      originRef.current = { x: 1, y: 0.5 };
      onNext();
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      originRef.current = { x: 0, y: 0.5 };
      onPrevious();
    } else if (event.key === "Escape") {
      event.preventDefault();
      fieldRef.current?.releaseCarve();
    } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const delta = event.key === "ArrowUp" ? 0.02 : -0.02;
      const next = Math.round(Math.min(LENS_MAX, Math.max(LENS_MIN, liveLensRef.current + delta)) * 100) / 100;
      liveLensRef.current = next;
      onLens(next);
    }
  };

  return (
    <div
      ref={coverRef}
      className="qt-cover"
      tabIndex={0}
      role="img"
      aria-label={entry ? `${entry.title} by ${entry.artist}, drawn as a quadtree. Press Space for the next cover, arrows to browse, Escape to release carved detail.` : "Quadtree"}
      style={{ "--qt-lens": params.lens }}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onPointerMove={handlePointerMove}
      onPointerDown={handlePointerDown}
      onPointerUp={(event) => finishPress(event, false)}
      onPointerCancel={(event) => finishPress(event, true)}
      onKeyDown={handleKeyDown}
    >
      <div className="qt-cover__well" />
      <div ref={canvasHostRef} className="qt-canvas-host" />
      <div ref={lensRef} className="qt-lens" aria-hidden="true">
        <div ref={ringRef} className="qt-lens__ring" />
      </div>
    </div>
  );
}
