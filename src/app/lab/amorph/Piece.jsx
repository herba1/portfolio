"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { albumById } from "@/app/lab/_music/catalog";
import MorphText from "@/app/ui/MorphText";
import AmorphEngine from "./amorphEngine";
import "./amorph.css";

const PORTRAITS = ["abbey-road", "revolver", "rubber-soul", "sgt-pepper", "let-it-be", "help"].map((id) => {
  const album = albumById(id);
  return { name: id === "sgt-pepper" ? "Sgt. Pepper" : album.title, year: album.year, src: album.cover };
});

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
    pointerRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    setHolding(true);
  }, []);

  const handlePointerUp = useCallback((event) => {
    const start = pointerRef.current;
    pointerRef.current = null;
    setHolding(false);
    if (!start || start.id !== event.pointerId) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12) return;
    const engine = engineRef.current;
    engine?.advance(engine.toUnit(event.clientX, event.clientY));
  }, []);

  const handlePointerCancel = useCallback(() => {
    pointerRef.current = null;
    setHolding(false);
  }, []);

  const handleKeyDown = useCallback((event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === " " || event.key === "Enter" || event.key === "ArrowRight") {
      event.preventDefault();
      if (!event.repeat) engineRef.current?.advance([0, 0]);
    }
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
        aria-label={`${portrait.name} by the Beatles, printed in dots. Every few seconds the print bursts apart into flying dots and springs back together as the next album cover. Click anywhere to burst it from that point, or press Enter.`}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        onKeyDown={handleKeyDown}
        onContextMenu={preventMenu}
      >
        <canvas ref={canvasRef} className="amorph__canvas" aria-hidden="true" />
      </div>

      {embedded ? null : (
        <>
          <header className="amorph__head">
            <h1 className="amorph__title text-title-sm">Amorph</h1>
            <p className="amorph__hint text-ui-lg">
              Click anywhere on the cover and it <em>bursts apart</em> into the next one.
            </p>
          </header>

          <footer className="amorph__foot">
            <p className="amorph__who text-ui-lg" aria-live="polite">
              <span className="amorph__index text-ui-sm tabular-nums">{`0${current + 1}`}</span>
              <MorphText className="amorph__name" text={portrait.name} />
              <span className="amorph__year text-ui tabular-nums">{portrait.year}</span>
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
