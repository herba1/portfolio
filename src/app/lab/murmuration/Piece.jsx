"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import "./murmuration.css";

const LABEL =
  "A flock of starlings over a reedbed at dusk. Your pointer is a hawk: fly it at the flock and the birds tear away from it in a dark wave, then fold back together. Arrow keys fly the hawk, Enter sends it through the flock.";

const STEP = 28;
const ARROWS = { ArrowLeft: [-STEP, 0], ArrowRight: [STEP, 0], ArrowUp: [0, -STEP], ArrowDown: [0, STEP] };

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const skyRef = useRef(null);
  const flockRef = useRef(null);
  const landRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    const box = root.closest(".piece-box") ?? root;
    let engine = null;
    let cancelled = false;
    import("./murmurationEngine").then(({ default: Engine }) => {
      if (cancelled) return;
      engine = new Engine({
        sky: skyRef.current,
        flock: flockRef.current,
        land: landRef.current,
        box,
        embedded,
        onReady: () => setReady(true),
      });
      engineRef.current = engine;
    });
    return () => {
      cancelled = true;
      engine?.destroy();
      engineRef.current = null;
    };
  }, [embedded]);

  const local = (event) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return [event.clientX - rect.left, event.clientY - rect.top];
  };

  const onPointerMove = useCallback((event) => {
    const [x, y] = local(event);
    engineRef.current?.pointerMove(x, y, event.pointerType);
  }, []);

  const onPointerDown = useCallback((event) => {
    if (event.pointerType !== "mouse") event.currentTarget.setPointerCapture?.(event.pointerId);
    const [x, y] = local(event);
    engineRef.current?.pointerMove(x, y, event.pointerType);
  }, []);

  const onPointerEnd = useCallback((event) => {
    if (event.pointerType === "mouse" && event.type === "pointerup") return;
    engineRef.current?.pointerLeave();
  }, []);

  const onKeyDown = useCallback((event) => {
    const engine = engineRef.current;
    if (!engine || event.metaKey || event.ctrlKey || event.altKey) return;
    const arrow = ARROWS[event.key];
    if (arrow) {
      event.preventDefault();
      engine.nudge(arrow[0], arrow[1]);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (!event.repeat) engine.stoop();
    }
  }, []);

  const onBlur = useCallback(() => engineRef.current?.pointerLeave(), []);

  return (
    <div ref={rootRef} className="murmuration" data-ready={ready ? "" : undefined} data-embedded={embedded ? "" : undefined}>
      <canvas ref={skyRef} className="murmuration__sky" aria-hidden="true" />
      <div
        className="murmuration__stage"
        tabIndex={0}
        role="application"
        aria-label={LABEL}
        onPointerMove={onPointerMove}
        onPointerDown={onPointerDown}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onPointerLeave={onPointerEnd}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
      >
        <canvas ref={flockRef} className="murmuration__flock" aria-hidden="true" />
        <canvas ref={landRef} className="murmuration__land" aria-hidden="true" />
      </div>
      {embedded ? null : (
        <header className="murmuration__head">
          <h1 className="murmuration__title">Murmuration</h1>
          <p className="murmuration__lede">
            Starlings over the reedbed at dusk. You are the <em>hawk</em>.
          </p>
        </header>
      )}
    </div>
  );
}
