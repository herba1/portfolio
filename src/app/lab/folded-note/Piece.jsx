"use client";

import localFont from "next/font/local";
import { useEffect, useRef, useState } from "react";

import "./folded-note.css";

const hand = localFont({ src: "./LaBelleAurore.ttf", display: "block", fallback: ["cursive"] });

const LABELS = {
  folded: "A note folded in quarters. Press Enter to unfold it one panel at a time.",
  half: "Half unfolded. Press Enter to open the last fold.",
  open: "The note is open. Press Enter to fold it back up.",
};

export default function Piece({ embedded = false }) {
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [state, setState] = useState("folded");

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      try {
        const { createNote } = await import("./noteEngine");
        if (cancelled) return;
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        engine = await createNote(stage, canvas, {
          family: hand.style.fontFamily,
          reducedMotion,
          onChange: (change) => setState(change.state),
        });
        if (cancelled) {
          engine.destroy();
          return;
        }
        engineRef.current = engine;
        setReady(true);
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
    io.observe(stage);
    return () => {
      cancelled = true;
      io.disconnect();
      engine?.destroy();
      engineRef.current = null;
    };
  }, [embedded]);

  const onKeyDown = (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    engineRef.current?.step();
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root className="folded-note-root text-ink" data-embedded={embedded ? "" : undefined}>
      <div ref={stageRef} className="folded-note-stage" data-ready={ready ? "" : undefined}>
        <canvas
          ref={canvasRef}
          className="folded-note-canvas"
          tabIndex={0}
          role="application"
          aria-label={LABELS[state]}
          onKeyDown={onKeyDown}
        />
        {failed ? <p className="folded-note-fallback text-ui-lg">This piece needs WebGL.</p> : null}
      </div>
      {embedded ? null : (
        <header className="folded-note-head">
          <h1 className="text-title-sm">Folded Note</h1>
          <p className="folded-note-hint text-ui-lg">Someone left you a note. Drag a panel to open it, or fold it back the way it came.</p>
          <button
            type="button"
            className="folded-note-button"
            onClick={() => (state === "open" ? engineRef.current?.foldUp() : engineRef.current?.unfoldAll())}
          >
            {state === "open" ? "Fold it back up" : "Unfold"}
          </button>
        </header>
      )}
      <p className="folded-note-live" aria-live="polite">
        {ready ? LABELS[state] : ""}
      </p>
    </Root>
  );
}
