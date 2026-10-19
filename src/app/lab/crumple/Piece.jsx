"use client";

import { useEffect, useRef, useState } from "react";

import { SHEETS } from "./crumpleSheets";
import "./crumple.css";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const cursorRef = useRef(null);
  const engineRef = useRef(null);
  const [sheet, setSheet] = useState(0);
  const [status, setStatus] = useState("loading");

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
      try {
        const { createCrumple } = await import("./crumpleEngine");
        if (disposed) return;
        const made = await createCrumple({
          root,
          stage: stageRef.current,
          canvas: canvasRef.current,
          cursor: cursorRef.current,
          onSheet: (idx) => {
            if (!disposed) setSheet(idx);
          },
        });
        if (disposed) {
          made.destroy();
          return;
        }
        engine = made;
        engineRef.current = made;
        setStatus("ready");
        sync();
      } catch (error) {
        console.error(error);
        if (!disposed) setStatus("failed");
      }
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
    <div ref={rootRef} className="crumple" data-embedded={embedded || undefined} data-status={status}>
      <div
        ref={stageRef}
        className="crumple__stage"
        tabIndex={0}
        role="application"
        aria-label={`${SHEETS[sheet].title}. Press and hold on the paper to crumple it into a ball and drag it around; let go and it opens out again with its creases. Space crumples and releases it.`}
      >
        <canvas ref={canvasRef} className="crumple__canvas" />
        <div ref={cursorRef} className="crumple__cursor" aria-hidden="true">
          <span className="crumple__cursor-ring" />
        </div>
      </div>
      {!embedded && (
        <header className="crumple__head">
          <h1 className="crumple__title">Crumple</h1>
          <p className="crumple__hint">
            Hold the paper to scrunch it into a ball. Let go and it opens out <em>creased</em>.
          </p>
        </header>
      )}
      {!embedded && (
        <div className="crumple__bar">
          <div className="crumple__seg" role="radiogroup" aria-label="Sheet">
            {SHEETS.map((s, i) => (
              <button
                key={s.key}
                type="button"
                role="radio"
                aria-checked={sheet === i}
                className="crumple__key"
                disabled={status !== "ready"}
                onClick={() => {
                  setSheet(i);
                  engineRef.current?.setSheet(i);
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
          <button type="button" className="crumple__key crumple__iron" disabled={status !== "ready"} onClick={() => engineRef.current?.smooth()}>
            Smooth it out
          </button>
        </div>
      )}
      {status === "failed" && <p className="crumple__fallback">This piece could not load its paper.</p>}
    </div>
  );
}
