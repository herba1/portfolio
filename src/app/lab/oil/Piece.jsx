"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import useNearViewport from "@/app/experiments/useNearViewport";

import OilEngine from "./oilEngine";
import { TUBES, rybToCss } from "./oilArt";
import "./oil.css";

const SWATCHES = TUBES.map((tube) => rybToCss(tube.ryb));

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const cursorRef = useRef(null);
  const engineRef = useRef(null);
  const pointerRef = useRef(null);
  const near = useNearViewport(rootRef);
  const [phase, setPhase] = useState("loading");
  const [tube, setTube] = useState(0);
  const [strokes, setStrokes] = useState(0);
  const [painting, setPainting] = useState(false);

  useEffect(() => {
    if (!near) return undefined;
    const engine = new OilEngine({
      root: rootRef.current,
      stage: stageRef.current,
      canvas: canvasRef.current,
      cursor: cursorRef.current,
      tube: 0,
      onReady: () => setPhase("ready"),
      onError: () => setPhase("error"),
      onStroke: () => setStrokes((count) => count + 1),
    });
    engineRef.current = engine;
    engine.start();
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [near]);

  const onDown = useCallback((event) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    if (pointerRef.current != null) return;
    pointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setPainting(true);
    engineRef.current?.press(event.clientX, event.clientY);
  }, []);

  const onMove = useCallback((event) => {
    if (pointerRef.current != null && pointerRef.current !== event.pointerId) return;
    if (pointerRef.current == null && event.pointerType !== "mouse") return;
    engineRef.current?.hover(event.clientX, event.clientY);
  }, []);

  const onUp = useCallback((event) => {
    if (pointerRef.current !== event.pointerId) return;
    pointerRef.current = null;
    setPainting(false);
    engineRef.current?.release();
  }, []);

  const onLeave = useCallback(() => {
    if (pointerRef.current == null) engineRef.current?.leave();
  }, []);

  const chooseTube = (index) => {
    setTube(index);
    engineRef.current?.setTube(index);
  };

  const onTubeKey = (event) => {
    const moves = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    const next = (tube + moves[event.key] + TUBES.length) % TUBES.length;
    chooseTube(next);
    event.currentTarget.parentElement?.children[next]?.focus();
  };

  const startOver = () => {
    engineRef.current?.reset();
    setStrokes(0);
  };

  return (
    <div
      ref={rootRef}
      className="oil"
      data-phase={phase}
      data-ready={phase === "ready" ? "" : undefined}
      data-embedded={embedded ? "" : undefined}
      data-painting={painting ? "" : undefined}
      style={{ "--oil-tube": SWATCHES[tube] }}
    >
      <div ref={stageRef} className="oil__stage" aria-hidden="true" />
      <canvas
        ref={canvasRef}
        className="oil__canvas"
        role="img"
        aria-label="A small oil study on primed linen: the word oil in thick ultramarine over pale yellow, with a red dot on the i. Drag across it to paint with a flat brush; colours mix as they would on a real canvas."
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onPointerLeave={onLeave}
      />
      <span ref={cursorRef} className="oil__brush" aria-hidden="true" />

      <p className="oil__caption">
        <span>Study in oil on primed linen</span>
        <span className="oil__count">
          {strokes === 0 ? "Untouched" : `${strokes} ${strokes === 1 ? "stroke" : "strokes"}`}
        </span>
      </p>

      {embedded ? null : (
        <header className="oil__head">
          <h1 className="oil__title">Oil</h1>
          <p className="oil__lede">
            Thick paint with a raking light. Pull the brush through it and the colours <em>mix like pigment</em>, blue into yellow
            turning green, while every bristle leaves a ridge that catches the gloss.
          </p>
        </header>
      )}

      <div className="oil__bar">
        <div className="oil__tubes" role="radiogroup" aria-label="Paint">
          {TUBES.map((entry, index) => (
            <button
              key={entry.id}
              type="button"
              role="radio"
              aria-checked={tube === index}
              aria-label={entry.name}
              tabIndex={tube === index ? 0 : -1}
              className="oil__tube"
              onClick={() => chooseTube(index)}
              onKeyDown={onTubeKey}
              style={{ "--oil-swatch": SWATCHES[index] }}
            >
              <span className="oil__swatch" aria-hidden="true" />
              <span className="oil__tube-name" aria-hidden="true">
                {entry.name}
              </span>
            </button>
          ))}
        </div>
        <button type="button" className="oil__reset" onClick={startOver} disabled={phase !== "ready"}>
          Start over
        </button>
      </div>

      {phase === "error" ? <p className="oil__error">This piece needs WebGL 2 to paint.</p> : null}
    </div>
  );
}
