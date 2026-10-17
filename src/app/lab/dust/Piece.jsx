"use client";

import { useEffect, useRef } from "react";

import useNearViewport from "@/app/experiments/useNearViewport";

import "./dust.css";

const STAGE_LABEL =
  "An old LP cover lying on a wooden crate under a lamp, covered in grey basement dust. Drag across it to brush the dust away; slow strokes clean thoroughly, fast flicks scatter more dust and clean less. Press Enter for a brush stroke, and R or double-click to let the dust settle back.";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const cursorRef = useRef(null);
  const meterRef = useRef(null);
  const headRef = useRef(null);
  const barRef = useRef(null);
  const engineRef = useRef(null);
  const near = useNearViewport(rootRef);

  useEffect(() => {
    if (!near) return undefined;
    const root = rootRef.current;
    let cancelled = false;
    let engine = null;
    const insets = () => {
      if (embedded) return { top: 16, bottom: 16, left: 16, right: 16 };
      const box = root.getBoundingClientRect();
      const bar = barRef.current?.getBoundingClientRect();
      const bottom = bar ? box.bottom - bar.top + 20 : 88;
      if (box.width >= 1100) return { top: 80, bottom: Math.max(80, bottom), left: 300, right: 300 };
      const head = headRef.current?.getBoundingClientRect();
      const top = head ? head.bottom - box.top + 16 : 160;
      return { top, bottom, left: 16, right: 16 };
    };
    const start = async () => {
      try {
        const { default: DustEngine } = await import("./dustEngine");
        if (cancelled) return;
        engine = new DustEngine({
          host: stageRef.current,
          canvas: canvasRef.current,
          cursor: cursorRef.current,
          meter: meterRef.current,
          insets,
          embedded,
          onReady: () => root.setAttribute("data-ready", ""),
          onFail: () => root.setAttribute("data-failed", ""),
        });
        engineRef.current = engine;
        engine.start();
      } catch (error) {
        console.error(error);
        root.setAttribute("data-failed", "");
      }
    };
    start();
    return () => {
      cancelled = true;
      engine?.destroy();
      engineRef.current = null;
    };
  }, [near, embedded]);

  const onStageKey = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      engineRef.current?.brushNow();
      return;
    }
    if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      engineRef.current?.redust();
    }
  };

  return (
    <div ref={rootRef} className="dust" data-embedded={embedded ? "" : undefined}>
      <div ref={stageRef} className="dust__stage" tabIndex={0} role="application" aria-label={STAGE_LABEL} onKeyDown={onStageKey}>
        <canvas ref={canvasRef} className="dust__canvas" />
        <span ref={cursorRef} className="dust__cursor" aria-hidden="true" />
      </div>

      {!embedded && (
        <header ref={headRef} className="dust__head">
          <h1 className="dust__title">Dust</h1>
          <p className="dust__lede">
            Fifty years in a basement. Brush it slowly to bring the gloss back, or flick it and <em>watch it fly</em>.
          </p>
        </header>
      )}

      {!embedded && (
        <div ref={barRef} className="dust__bar">
          <p className="dust__meter">
            <span ref={meterRef} className="dust__meter-value">0%</span>
            <span>clean</span>
          </p>
          <button type="button" className="dust__settle" onClick={() => engineRef.current?.redust()}>
            Let it settle
          </button>
        </div>
      )}

      <p className="dust__fallback">This piece needs WebGL 2.</p>
    </div>
  );
}
