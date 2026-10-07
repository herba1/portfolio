"use client";

import { useEffect, useRef } from "react";

import { LOST_CONTEXT, createLoom } from "./loomEngine";

const CANVAS_LABEL =
  "Woven album cover. Drag across to pull a row, down to pull a column, tap a thread to pluck it. Up and down pick a row, Shift with left or right pulls it, Space plucks.";

function mountCanvas(host) {
  const canvas = document.createElement("canvas");
  canvas.className = "loom-canvas";
  canvas.tabIndex = 0;
  canvas.setAttribute("aria-label", CANVAS_LABEL);
  host.appendChild(canvas);
  return canvas;
}

export default function LoomStage({ covers, index, direction, params, reducedMotion, onPainted, onError, onEngine }) {
  const hostRef = useRef(null);
  const engineRef = useRef(null);
  const latestRef = useRef({ index, params, onPainted, onError, onEngine });

  useEffect(() => {
    latestRef.current = { index, params, onPainted, onError, onEngine };
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
    const onBlur = () => engine.onBlur();
    canvas.addEventListener("keydown", onKeyDown);
    canvas.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", sync);
    sync();

    return () => {
      resizeObserver.disconnect();
      intersection.disconnect();
      canvas.removeEventListener("keydown", onKeyDown);
      canvas.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", sync);
      latestRef.current.onEngine?.(null);
      engine.destroy();
      canvas.remove();
      engineRef.current = null;
    };
  }, [covers, reducedMotion]);

  useEffect(() => {
    engineRef.current?.goTo(index, direction);
  }, [index, direction]);

  useEffect(() => {
    engineRef.current?.setParams(params);
  }, [params]);

  return <div ref={hostRef} className="loom-host" />;
}
