"use client";

import { useEffect, useRef, useState } from "react";

import useNearViewport from "@/app/experiments/useNearViewport";

import "./film-leader.css";

const STAGE_LABEL =
  "A 35mm film canister on a light table with a strip of colour negative pulled out. Drag the leader or any part of the strip to pull more film out; let go and it curls slowly back. Hover or tap a frame to see it as a print. Right arrow pulls a frame, left arrow winds back, and P switches every frame between negative and print.";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const statusRef = useRef(null);
  const engineRef = useRef(null);
  const printRef = useRef(false);
  const near = useNearViewport(rootRef);
  const [print, setPrint] = useState(false);

  useEffect(() => {
    if (!near) return undefined;
    const root = rootRef.current;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      try {
        const { createFilmEngine } = await import("./filmEngine");
        if (cancelled) return;
        engine = await createFilmEngine({
          host: stageRef.current,
          canvas: canvasRef.current,
          embedded,
          onReady: () => root.setAttribute("data-ready", ""),
          onFail: () => root.setAttribute("data-failed", ""),
          onStatus: (text) => {
            if (statusRef.current) statusRef.current.textContent = text;
          },
        });
        if (cancelled) {
          engine.destroy();
          return;
        }
        engine.setPrint(printRef.current);
        engineRef.current = engine;
      } catch (error) {
        console.error(error);
        if (!cancelled) root.setAttribute("data-failed", "");
      }
    };
    start();
    return () => {
      cancelled = true;
      engine?.destroy();
      engineRef.current = null;
    };
  }, [near, embedded]);

  const choosePrint = (value) => {
    printRef.current = value;
    setPrint(value);
    engineRef.current?.setPrint(value);
  };

  const onKey = (e) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") {
      e.preventDefault();
      engineRef.current?.key("pull");
    } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
      e.preventDefault();
      engineRef.current?.key("rewind");
    } else if (e.key === "p" || e.key === "P" || e.key === "Enter") {
      e.preventDefault();
      choosePrint(!printRef.current);
    }
  };

  return (
    <div ref={rootRef} className="film-leader" data-embedded={embedded ? "" : undefined}>
      <div ref={stageRef} className="film-leader__stage" tabIndex={0} role="application" aria-label={STAGE_LABEL} onKeyDown={onKey}>
        <canvas ref={canvasRef} className="film-leader__canvas" />
      </div>

      {!embedded && (
        <header className="film-leader__head">
          <h1 className="film-leader__title">Film Leader</h1>
          <p className="film-leader__lede">
            Pull the leader out of the canister. Hover or tap a frame to see the <em>print</em>.
          </p>
        </header>
      )}

      {!embedded && (
        <div className="film-leader__bar">
          <div className="film-leader__toggle" role="radiogroup" aria-label="View">
            <button type="button" role="radio" aria-checked={!print} className="film-leader__option" onClick={() => choosePrint(false)}>
              <span className="film-leader__swatch film-leader__swatch--neg" aria-hidden="true" />
              Negative
            </button>
            <button type="button" role="radio" aria-checked={print} className="film-leader__option" onClick={() => choosePrint(true)}>
              <span className="film-leader__swatch film-leader__swatch--pos" aria-hidden="true" />
              Print
            </button>
          </div>
          <p className="film-leader__status" aria-live="polite">
            <span ref={statusRef} />
          </p>
        </div>
      )}

      <p className="film-leader__fallback">This piece needs WebGL.</p>
    </div>
  );
}
