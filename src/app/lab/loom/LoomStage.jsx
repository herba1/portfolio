"use client";

import { useEffect, useRef } from "react";

import { LOST_CONTEXT, createLoom } from "./loomEngine";

const CANVAS_LABEL =
  "Woven album cover. Left alone, the cloth swishes from record to record on its own; any touch takes over. Drag across to pull a row, down to pull a column, hold the pull out to keep the thread looping while the cloth follows, or flick it and let the cloth glide on to the next lap. Tap a thread to pluck it. Up and down pick a row, Shift with left or right pulls it, holding keeps it looping, Space plucks.";

function mountCanvas(host) {
  const canvas = document.createElement("canvas");
  canvas.className = "loom-canvas";
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-roledescription", "loom");
  canvas.setAttribute("aria-label", CANVAS_LABEL);
  host.appendChild(canvas);
  return canvas;
}

export default function LoomStage({ covers, index, direction, auto, params, reducedMotion, onPainted, onError, onEngine, onCover }) {
  const hostRef = useRef(null);
  const engineRef = useRef(null);
  const latestRef = useRef({ index, params, onPainted, onError, onEngine, onCover });

  useEffect(() => {
    latestRef.current = { index, params, onPainted, onError, onEngine, onCover };
  });

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    const latest = latestRef.current;
    const build = (canvas) =>
      createLoom({
        canvas,
        covers,
        index: latest.index,
        params: latest.params,
        reducedMotion,
        onPainted: () => latestRef.current.onPainted?.(),
        onError: (kind, message) => latestRef.current.onError?.(kind, message),
        onCover: (coverIndex, coverDirection) => latestRef.current.onCover?.(coverIndex, coverDirection),
      });

    let canvas = mountCanvas(host);
    let engine = build(canvas);
    if (engine === LOST_CONTEXT) {
      canvas.remove();
      canvas = mountCanvas(host);
      engine = build(canvas);
    }
    if (!engine || engine === LOST_CONTEXT) {
      canvas.remove();
      if (engine === LOST_CONTEXT) latestRef.current.onError?.("lost");
      return undefined;
    }
    engineRef.current = engine;
    latestRef.current.onEngine?.(engine);

    let onscreen = true;
    const sync = () => {
      const visible = document.visibilityState !== "hidden";
      engine.setPageVisible(visible);
      engine.setActive(visible && onscreen);
    };

    const resizeObserver = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      engine.setSize(width, height);
    });
    resizeObserver.observe(canvas);

    const intersection = new IntersectionObserver(([entry]) => {
      onscreen = entry.isIntersecting;
      sync();
    });
    intersection.observe(canvas);

    const onKeyDown = (event) => engine.onKeyDown(event);
    const onKeyUp = (event) => engine.onKeyUp(event);
    const onBlur = () => engine.onBlur();
    const onScroll = () => engine.invalidateRect();
    canvas.addEventListener("keydown", onKeyDown);
    canvas.addEventListener("keyup", onKeyUp);
    canvas.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("scroll", onScroll, { passive: true, capture: true });
    sync();

    return () => {
      resizeObserver.disconnect();
      intersection.disconnect();
      canvas.removeEventListener("keydown", onKeyDown);
      canvas.removeEventListener("keyup", onKeyUp);
      canvas.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("scroll", onScroll, { capture: true });
      latestRef.current.onEngine?.(null);
      engine.destroy();
      canvas.remove();
      engineRef.current = null;
    };
  }, [covers, reducedMotion]);

  useEffect(() => {
    if (!auto) engineRef.current?.goTo(index, direction);
  }, [index, direction, auto]);

  useEffect(() => {
    engineRef.current?.setParams(params);
  }, [params]);

  return <div ref={hostRef} className="loom-host" />;
}
