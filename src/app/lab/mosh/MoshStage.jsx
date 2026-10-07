"use client";

import { useEffect, useRef } from "react";

import createMoshEngine from "./moshEngine";

const TAP_SLOP_PX = 6;
const HOLD_MS = 260;
const EMBED_SWIPE_MS = 6000;
const WIDE_BUFFER = 640;
const COMPACT_BUFFER = 512;

function pickBuffer() {
  const compact = window.matchMedia("(max-width: 899px), (pointer: coarse)").matches;
  return compact ? COMPACT_BUFFER : WIDE_BUFFER;
}

function pickDprCap(embedded) {
  const coarse = window.matchMedia("(pointer: coarse)").matches;
  return embedded || coarse ? 1.5 : 2;
}

function unitX(box, clientX) {
  return Math.min(1, Math.max(0, (clientX - box.left) / Math.max(1, box.width)));
}

function unitY(box, clientY) {
  return Math.min(1, Math.max(0, (clientY - box.top) / Math.max(1, box.height)));
}

const PAN_KEYS = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

export default function MoshStage({ covers, params, embedded, reducedMotion, label, onApi, onReady, onCovers, onFrames, onError }) {
  const surfaceRef = useRef(null);
  const ringRef = useRef(null);
  const rectRef = useRef(null);
  const engineRef = useRef(null);
  const gestureRef = useRef(null);
  const paramsRef = useRef(params);
  const callbacksRef = useRef({ onApi, onReady, onCovers, onFrames, onError });

  useEffect(() => {
    callbacksRef.current = { onApi, onReady, onCovers, onFrames, onError };
  }, [onApi, onReady, onCovers, onFrames, onError]);

  useEffect(() => {
    paramsRef.current = params;
    engineRef.current?.setParams(params);
  }, [params]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return undefined;
    const canvas = document.createElement("canvas");
    canvas.className = "mosh-canvas";
    canvas.setAttribute("aria-hidden", "true");
    surface.prepend(canvas);

    let engine = null;
    try {
      engine = createMoshEngine({
        canvas,
        covers,
        bufferSize: pickBuffer(),
        dprCap: pickDprCap(embedded),
        reducedMotion,
        callbacks: {
          onReady: () => callbacksRef.current.onReady?.(),
          onCovers: (state) => callbacksRef.current.onCovers?.(state),
          onFrames: (count, reset) => callbacksRef.current.onFrames?.(count, reset),
          onError: (message) => callbacksRef.current.onError?.(message),
        },
      });
    } catch (error) {
      canvas.remove();
      const message = error instanceof Error ? error.message : "WebGL2 is not available";
      queueMicrotask(() => callbacksRef.current.onError?.(message));
      return undefined;
    }

    engineRef.current = engine;
    engine.setParams(paramsRef.current);
    callbacksRef.current.onApi?.(engine);

    let onscreen = false;
    const sync = () => engine.setActive(onscreen && !document.hidden);

    const forgetRect = () => {
      rectRef.current = null;
    };
    window.addEventListener("scroll", forgetRect, { capture: true, passive: true });

    const resizeObserver = new ResizeObserver(([entry]) => {
      rectRef.current = null;
      const width = entry.contentRect.width;
      engine.resize(width, window.devicePixelRatio || 1);
      surface.style.setProperty("--mosh-block-css", `${(width / engine.bufferSize) * engine.block}px`);
    });
    resizeObserver.observe(surface);

    const intersectionObserver = new IntersectionObserver(
      ([entry]) => {
        onscreen = entry.isIntersecting;
        sync();
      },
      { rootMargin: "64px 0px" },
    );
    intersectionObserver.observe(surface);
    document.addEventListener("visibilitychange", sync);

    const handleKey = (event) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const origin = event.target;
      const onSurface = origin === surface;
      const onPage = !embedded && (origin === document.body || origin === document.documentElement);
      if (!onSurface && !onPage) return;
      if (event.key === " " || (onSurface && event.key === "Enter")) {
        event.preventDefault();
        if (!event.repeat) engine.keyframe();
        return;
      }
      const direction = PAN_KEYS[event.key];
      if (!direction || !onSurface) return;
      event.preventDefault();
      engine.pan(direction[0], direction[1]);
    };
    window.addEventListener("keydown", handleKey);

    let swipeTimer = 0;
    let swipeCount = 0;
    if (embedded && !reducedMotion) {
      swipeTimer = window.setInterval(() => {
        if (!onscreen || document.hidden || gestureRef.current) return;
        engine.playSwipe(swipeCount);
        swipeCount += 1;
      }, EMBED_SWIPE_MS);
    }

    return () => {
      window.clearInterval(swipeTimer);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("scroll", forgetRect, { capture: true });
      const gesture = gestureRef.current;
      if (gesture) window.clearTimeout(gesture.holdTimer);
      gestureRef.current = null;
      callbacksRef.current.onApi?.(null);
      engineRef.current = null;
      engine.dispose();
      canvas.remove();
      rectRef.current = null;
    };
  }, [covers, embedded, reducedMotion]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    surface.style.setProperty("--mosh-block-css", `${(surface.clientWidth / (engineRef.current?.bufferSize ?? 640)) * params.block}px`);
  }, [params.block]);

  const readRect = () => {
    if (!rectRef.current) rectRef.current = surfaceRef.current.getBoundingClientRect();
    return rectRef.current;
  };

  const placeRing = (box, clientX, clientY) => {
    const ring = ringRef.current;
    if (!ring) return;
    ring.style.translate = `${clientX - box.left}px ${clientY - box.top}px`;
  };

  const endGesture = (event, cancelled) => {
    const gesture = gestureRef.current;
    const engine = engineRef.current;
    if (!gesture || gesture.id !== event.pointerId) return;
    window.clearTimeout(gesture.holdTimer);
    gestureRef.current = null;
    const surface = surfaceRef.current;
    if (surface?.hasPointerCapture?.(event.pointerId)) surface.releasePointerCapture(event.pointerId);
    if (ringRef.current) ringRef.current.dataset.on = "false";
    if (surface) surface.dataset.pressed = "false";
    if (!engine) return;
    engine.setPressed(false);
    if (gesture.freezing) {
      engine.releaseFreeze();
    } else if (!gesture.moved && !cancelled) {
      engine.keyframe();
    } else if (gesture.moved && reducedMotion) {
      engine.settle();
    }
    if (event.pointerType === "touch") engine.leave();
  };

  const handlePointerDown = (event) => {
    const engine = engineRef.current;
    const surface = surfaceRef.current;
    if (!engine || !surface || event.button > 0 || gestureRef.current) return;
    surface.setPointerCapture(event.pointerId);
    rectRef.current = surface.getBoundingClientRect();
    const box = rectRef.current;
    const x = unitX(box, event.clientX);
    const y = unitY(box, event.clientY);
    const gesture = {
      id: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      lastX: x,
      lastY: y,
      lastTime: event.timeStamp,
      moved: false,
      freezing: false,
      holdTimer: 0,
    };
    gesture.holdTimer = window.setTimeout(() => {
      if (gestureRef.current !== gesture || gesture.moved) return;
      gesture.freezing = true;
      engine.freezeAt(gesture.lastX, gesture.lastY);
      if (ringRef.current) ringRef.current.dataset.on = "true";
    }, HOLD_MS);
    gestureRef.current = gesture;
    placeRing(box, event.clientX, event.clientY);
    surface.dataset.pressed = "true";
    engine.setPressed(true);
    engine.hover(x, y);
  };

  const handlePointerMove = (event) => {
    const engine = engineRef.current;
    const surface = surfaceRef.current;
    if (!engine || !surface) return;
    const gesture = gestureRef.current;
    if (!gesture) {
      if (event.pointerType === "touch") return;
      const hoverBox = readRect();
      engine.hover(unitX(hoverBox, event.clientX), unitY(hoverBox, event.clientY));
      return;
    }
    if (gesture.id !== event.pointerId) return;
    const box = readRect();
    const x = unitX(box, event.clientX);
    const y = unitY(box, event.clientY);
    placeRing(box, event.clientX, event.clientY);

    if (gesture.freezing) {
      gesture.lastX = x;
      gesture.lastY = y;
      engine.freezeAt(x, y);
      return;
    }
    if (!gesture.moved) {
      const travel = Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY);
      if (travel < TAP_SLOP_PX) {
        gesture.lastX = x;
        gesture.lastY = y;
        return;
      }
      gesture.moved = true;
      window.clearTimeout(gesture.holdTimer);
    }

    const samples = event.getCoalescedEvents ? event.getCoalescedEvents() : null;
    const count = samples?.length ?? 0;
    for (let index = 0; index < Math.max(1, count); index += 1) {
      const sample = count ? samples[index] : event;
      const sampleX = unitX(box, sample.clientX);
      const sampleY = unitY(box, sample.clientY);
      const elapsed = Math.max(4, sample.timeStamp - gesture.lastTime);
      engine.drag(gesture.lastX, gesture.lastY, sampleX, sampleY, elapsed);
      gesture.lastX = sampleX;
      gesture.lastY = sampleY;
      gesture.lastTime = sample.timeStamp;
    }
    engine.hover(x, y);
  };

  const handlePointerLeave = (event) => {
    if (gestureRef.current || event.pointerType === "touch") return;
    engineRef.current?.leave();
  };

  return (
    <div
      ref={surfaceRef}
      className="mosh-surface"
      tabIndex={0}
      role="application"
      aria-label={label}
      data-pressed="false"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(event) => endGesture(event, false)}
      onPointerCancel={(event) => endGesture(event, true)}
      onLostPointerCapture={(event) => endGesture(event, true)}
      onPointerLeave={handlePointerLeave}
    >
      <span ref={ringRef} className="mosh-ring" data-on="false" aria-hidden="true" />
    </div>
  );
}
