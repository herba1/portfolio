"use client";

import { useEffect, useRef } from "react";

import useNearViewport from "@/app/experiments/useNearViewport";

import LouvresEngine from "./louvresEngine";
import "./louvres.css";

const WALL_LABEL =
  "A wall of tall reeded-glass louvres in front of a mountain valley. Drag sideways across the blades to turn them on their pivots; they refract and slice the view and settle back on their own. Press the left or right arrow to send a wave along the wall.";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const wallRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const near = useNearViewport(rootRef);

  useEffect(() => {
    if (!near) return undefined;
    const root = rootRef.current;
    const floorShare = () => {
      if (embedded) return 0.2;
      return root.clientWidth < 600 ? 0.27 : 0.25;
    };
    const ceiling = () => (embedded ? 0 : 64);
    const engine = new LouvresEngine({
      host: wallRef.current,
      canvas: canvasRef.current,
      floorShare,
      ceiling,
      onReady: () => root.setAttribute("data-ready", ""),
      onFail: () => root.setAttribute("data-fallback", ""),
    });
    engineRef.current = engine;
    engine.start();
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [near, embedded]);

  const onWallKey = (e) => {
    if (e.key === "ArrowRight" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      engineRef.current?.nudge(1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      engineRef.current?.nudge(-1);
    }
  };

  return (
    <div ref={rootRef} className="louvres" data-embedded={embedded ? "" : undefined}>
      <div ref={wallRef} className="louvres__wall" tabIndex={0} role="application" aria-label={WALL_LABEL} onKeyDown={onWallKey}>
        <img className="louvres__fallback" src="/scorch/valley.webp" alt="" draggable={false} />
        <canvas ref={canvasRef} className="louvres__canvas" />
      </div>

      {!embedded && (
        <header className="louvres__head">
          <h1 className="louvres__title">Louvres</h1>
          <p className="louvres__lede">
            Drag across the glass to turn the blades. They <em>settle back</em> on their own.
          </p>
        </header>
      )}
    </div>
  );
}
