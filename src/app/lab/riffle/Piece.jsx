"use client";

import { useEffect, useRef, useState } from "react";

import { FRAMES } from "./riffleFrames";
import "./riffle.css";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let disposed = false;
    let started = false;
    let visible = false;
    let engine = null;
    const sync = () => engine?.setActive(visible && !document.hidden);
    const start = async () => {
      started = true;
      const { createRiffle } = await import("./riffleEngine");
      if (disposed) return;
      engine = createRiffle({
        root,
        stage: stageRef.current,
        canvas: canvasRef.current,
        onFrame: (f) => {
          if (!disposed) setFrame(f);
        },
        onPlaying: (p) => {
          if (!disposed) setPlaying(p);
        },
        onReady: () => {
          if (!disposed) setReady(true);
        },
      });
      engineRef.current = engine;
      sync();
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible && !started) start();
        sync();
      },
      { rootMargin: "160px" },
    );
    io.observe(root);
    document.addEventListener("visibilitychange", sync);
    return () => {
      disposed = true;
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      engine?.destroy();
      engineRef.current = null;
    };
  }, []);

  return (
    <div ref={rootRef} className="riffle" data-embedded={embedded || undefined} data-ready={ready || undefined}>
      <div
        ref={stageRef}
        className="riffle__stage"
        tabIndex={0}
        role="application"
        aria-label={`A flip book of the Beatles walking over the Abbey Road crossing, page ${frame + 1} of ${FRAMES}. Drag across the pages to riffle them, faster or backwards; arrow keys turn one page, Space plays or pauses.`}
      >
        <canvas ref={canvasRef} className="riffle__canvas" />
      </div>
      {!embedded && (
        <header className="riffle__head">
          <h1 className="riffle__title">Riffle</h1>
          <p className="riffle__lede">
            Forty-eight pages of the walk across <em>Abbey Road</em>. Drag to riffle them at your own speed.
          </p>
        </header>
      )}
      {!embedded && (
        <div className="riffle__bar">
          <button type="button" className="riffle__play" aria-pressed={playing} onClick={() => engineRef.current?.toggle()}>
            {playing ? "Pause" : "Play"}
          </button>
          <span className="riffle__count" aria-hidden="true">
            {String(frame + 1).padStart(2, "0")} / {FRAMES}
          </span>
        </div>
      )}
    </div>
  );
}
