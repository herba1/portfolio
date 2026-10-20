"use client";

import { useEffect, useRef, useState } from "react";

import useNearViewport from "@/app/experiments/useNearViewport";

import "./wet-type.css";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const bladeRef = useRef(null);
  const headRef = useRef(null);
  const engineRef = useRef(null);
  const near = useNearViewport(rootRef);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!near) return undefined;
    let cancelled = false;
    let engine = null;
    const stage = stageRef.current;
    const insets = () => {
      const box = stage.getBoundingClientRect();
      const head = headRef.current?.getBoundingClientRect();
      return { top: head ? head.bottom - box.top + 24 : 24, bottom: 48 };
    };
    import("./wetTypeEngine").then(({ createWetType }) => {
      if (cancelled) return;
      engine = createWetType(stage, {
        canvas: canvasRef.current,
        blade: bladeRef.current,
        insets,
        onReady: () => setReady(true),
        onFail: () => setFailed(true),
      });
      engineRef.current = engine;
    });
    return () => {
      cancelled = true;
      engine?.destroy();
      engineRef.current = null;
    };
  }, [near]);

  const onKey = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      engineRef.current?.sweep();
    }
  };

  return (
    <div ref={rootRef} className="wet-type" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      <div
        ref={stageRef}
        className="wet-type__stage"
        tabIndex={0}
        role="img"
        aria-label="The word monsoon printed huge in wet blue ink. Drag across it and the letters smear along your stroke in combed streaks, then slowly pull themselves back together. Press Enter for a squeegee pass."
        onKeyDown={onKey}
      >
        <canvas ref={canvasRef} className="wet-type__canvas" />
        <span ref={bladeRef} className="wet-type__blade" aria-hidden="true" />
      </div>

      {embedded ? null : (
        <header ref={headRef} className="wet-type__head">
          <h1 className="wet-type__title">Wet Type</h1>
          <p className="wet-type__hint">Drag across the word.</p>
        </header>
      )}

      {failed ? <p className="wet-type__fallback">This piece needs WebGL 2.</p> : null}
    </div>
  );
}
