"use client";

import { useEffect, useRef, useState } from "react";

import "./reeded.css";

const MODES = [
  { id: "architectural", label: "Architectural" },
  { id: "painterly", label: "Painterly" },
];

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const paneRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState("architectural");

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    const pane = paneRef.current;
    if (!root || !canvas || !pane) return undefined;
    let cancelled = false;
    const start = async () => {
      try {
        const { createReeded } = await import("./reededEngine");
        if (cancelled) return;
        engineRef.current = createReeded({
          box: root,
          canvas,
          pane,
          embedded,
          onReady: () => {
            if (!cancelled) setReady(true);
          },
          onMode: (m) => {
            if (!cancelled) setMode(m);
          },
        });
      } catch (error) {
        console.error(error);
        if (!cancelled) setFailed(true);
      }
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        start();
      },
      { rootMargin: "240px" },
    );
    io.observe(root);
    return () => {
      cancelled = true;
      io.disconnect();
      engineRef.current?.destroy();
      engineRef.current = null;
    };
  }, [embedded]);

  const choose = (id) => {
    setMode(id);
    engineRef.current?.setMode(id === "painterly" ? 1 : 0);
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root
      ref={rootRef}
      className="reeded-root"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
      data-failed={failed ? "" : undefined}
    >
      <canvas ref={canvasRef} className="reeded-canvas" aria-hidden="true" />
      <div
        ref={paneRef}
        className="reeded-pane"
        tabIndex={0}
        role="group"
        aria-roledescription="draggable glass pane"
        aria-label="Reeded glass pane over a poster. Drag it sideways, or use the arrow keys."
      />
      <div className="reeded-dock" role="radiogroup" aria-label="Reed pattern" data-mode={mode}>
        <span className="reeded-thumb" aria-hidden="true" />
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={mode === m.id}
            className="reeded-option"
            onClick={() => choose(m.id)}
          >
            {m.label}
          </button>
        ))}
      </div>
      {embedded ? null : (
        <header className="reeded-head">
          <h1 className="reeded-title">Reeded Glass</h1>
          <p className="reeded-lede">Slide the pane across the poster. Every reed is a small lens that turns its strip of the page over, so the type and the sun re-slice rib by rib.</p>
        </header>
      )}
      {failed ? <p className="reeded-fallback">This piece needs WebGL 2.</p> : null}
    </Root>
  );
}
