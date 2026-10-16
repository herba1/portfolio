"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import MorphText from "@/app/ui/MorphText";
import AmorphEngine from "./amorphEngine";
import "./amorph.css";

const PORTRAITS = [
  { name: "John", src: "/cast/john.webp" },
  { name: "Paul", src: "/cast/paul.webp" },
  { name: "George", src: "/cast/george.webp" },
];

const INKS = [
  { key: "colour", label: "Colour", mix: 0, hex: null },
  { key: "carbon", label: "Carbon", mix: 1, hex: "#1d1b18" },
  { key: "riso", label: "Riso blue", mix: 1, hex: "#2541b8" },
];

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const pointerRef = useRef(null);
  const [phase, setPhase] = useState("loading");
  const [current, setCurrent] = useState(0);
  const [ink, setInk] = useState(INKS[0].key);
  const [holding, setHolding] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    const box = root.closest(".piece-box") ?? root;
    const engine = new AmorphEngine({
      canvas: canvasRef.current,
      box,
      portraits: PORTRAITS,
      embedded,
      onPortrait: (index) => setCurrent(index),
      onReady: () => setPhase("ready"),
      onError: () => setPhase("error"),
    });
    engineRef.current = engine;
    return () => {
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [embedded]);

  const handlePointerDown = useCallback((event) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    if (pointerRef.current != null) return;
    pointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    engineRef.current?.press(event.clientX, event.clientY);
    setHolding(true);
  }, []);

  const handlePointerMove = useCallback((event) => {
    const engine = engineRef.current;
    if (!engine) return;
    if (pointerRef.current === event.pointerId) engine.moveHold(event.clientX, event.clientY);
    else if (event.pointerType === "mouse") engine.hover(event.clientX, event.clientY);
  }, []);

  const finish = useCallback((event, commit) => {
    if (pointerRef.current !== event.pointerId) return;
    pointerRef.current = null;
    if (commit) engineRef.current?.release();
    else engineRef.current?.cancel();
    setHolding(false);
  }, []);

  const handlePointerUp = useCallback((event) => finish(event, true), [finish]);
  const handlePointerCancel = useCallback((event) => finish(event, false), [finish]);
  const handlePointerLeave = useCallback((event) => {
    if (event.pointerType === "mouse") engineRef.current?.leave();
  }, []);

  const handleKeyDown = useCallback((event) => {
    const engine = engineRef.current;
    if (!engine || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === " ") {
      event.preventDefault();
      if (!event.repeat) {
        engine.press(null, null);
        setHolding(true);
      }
    } else if (event.key === "Enter" || event.key === "ArrowRight") {
      event.preventDefault();
      engine.advance();
    }
  }, []);

  const handleKeyUp = useCallback((event) => {
    if (event.key !== " ") return;
    event.preventDefault();
    engineRef.current?.release();
    setHolding(false);
  }, []);

  const handleBlur = useCallback(() => {
    engineRef.current?.cancel();
    setHolding(false);
  }, []);

  const chooseInk = useCallback((option) => {
    setInk(option.key);
    engineRef.current?.setInk(option.mix, option.hex);
  }, []);

  const preventMenu = useCallback((event) => event.preventDefault(), []);
  const portrait = PORTRAITS[current];

  return (
    <div
      ref={rootRef}
      className="amorph"
      data-phase={phase}
      data-embedded={embedded || undefined}
      data-holding={holding || undefined}
    >
      <div
        className="amorph__surface"
        tabIndex={0}
        role="application"
        aria-roledescription="particle portrait"
        aria-label={`Portrait of ${portrait.name} printed in dots. Press and hold to dissolve it, release to let every dot flow into the next face. Space holds, Enter moves on.`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onPointerLeave={handlePointerLeave}
        onKeyDown={handleKeyDown}
        onKeyUp={handleKeyUp}
        onBlur={handleBlur}
        onContextMenu={preventMenu}
      >
        <canvas ref={canvasRef} className="amorph__canvas" aria-hidden="true" />
      </div>

      {embedded ? null : (
        <>
          <header className="amorph__head">
            <h1 className="amorph__title text-title-sm">Amorph</h1>
            <p className="amorph__hint text-ui-lg">
              Hold to dissolve. Let go and every dot finds its tone in the next face.
            </p>
          </header>

          <footer className="amorph__foot">
            <p className="amorph__who text-ui-lg" aria-live="polite">
              <span className="amorph__index text-ui-sm tabular-nums">{`0${current + 1}`}</span>
              <MorphText className="amorph__name" text={portrait.name} />
            </p>
            <div className="amorph__inks" role="radiogroup" aria-label="Ink">
              {INKS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  role="radio"
                  aria-checked={ink === option.key}
                  className="amorph__chip text-ui"
                  onClick={() => chooseInk(option)}
                >
                  <span className="amorph__swatch" data-ink={option.key} aria-hidden="true" />
                  {option.label}
                </button>
              ))}
            </div>
          </footer>
        </>
      )}

      {phase === "error" ? <p className="amorph__error text-ui">This piece needs WebGL2 to print its dots.</p> : null}
    </div>
  );
}
