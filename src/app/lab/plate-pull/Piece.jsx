"use client";

import { useEffect, useRef, useState } from "react";

import "./plate-pull.css";

const LABELS = {
  sheet: "Pull a print",
  bare: "Ink and lay a sheet",
  busy: "Pulling",
};

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const headRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [phase, setPhase] = useState("sheet");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!root || !stage || !canvas) return undefined;
    let cancelled = false;
    let engine = null;
    const insets = (w) => {
      if (embedded) return { top: 12, bottom: 12, left: 12, right: 12 };
      if (w >= 1100) return { top: 88, bottom: 32, left: 336, right: 32 };
      const box = root.getBoundingClientRect();
      const head = headRef.current?.getBoundingClientRect();
      const top = head ? head.bottom - box.top + 16 : 176;
      if (w >= 700) return { top, bottom: 32, left: 40, right: 40 };
      return { top, bottom: 16, left: 12, right: 12 };
    };
    const onChange = (change) => {
      if (cancelled) return;
      if (change.phase) setPhase(change.phase);
      if (change.message) setStatus(change.message);
    };
    const start = async () => {
      try {
        const { createPlate } = await import("./plateEngine");
        if (cancelled) return;
        engine = await createPlate(stage, canvas, { embedded, onChange, insets });
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
    io.observe(root);
    return () => {
      cancelled = true;
      io.disconnect();
      engine?.destroy();
      engineRef.current = null;
    };
  }, [embedded]);

  const onKeyDown = (event) => {
    const engine = engineRef.current;
    if (!engine) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      engine.keyAction(event.shiftKey);
      return;
    }
    if (event.key === "Escape") {
      if (engine.keyCancel()) event.preventDefault();
    }
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root ref={rootRef} className="plate-pull-root" data-embedded={embedded ? "" : undefined}>
      <div ref={stageRef} className="plate-pull-stage" data-ready={ready ? "" : undefined}>
        <canvas
          ref={canvasRef}
          className="plate-pull-canvas"
          tabIndex={0}
          role="application"
          aria-label="A linocut block of a DJ, inked, with a sheet of Japanese paper half peeled from it. Drag the sheet by its corner to pull the print: slow pulls print rich, fast pulls print starved. Drag the brayer over the bare block to ink it again. With the keyboard, Enter pulls slowly, Shift and Enter pulls fast, and on a bare block Enter inks it and lays a fresh sheet."
          onKeyDown={onKeyDown}
        />
        {failed ? <p className="plate-pull-fallback">This piece needs WebGL 2.</p> : null}
      </div>
      {embedded ? null : (
        <header ref={headRef} className="plate-pull-head">
          <h1 className="plate-pull-title">Linocut Pull</h1>
          <p className="plate-pull-hint">
            Peel the sheet back by its corner. Pull <em>slowly</em> for a rich print, fast for a starved one, then roll the brayer to ink again.
          </p>
          <button
            type="button"
            className="plate-pull-button"
            disabled={!ready || phase === "busy"}
            onClick={() => engineRef.current?.keyAction(false)}
          >
            {LABELS[phase] ?? LABELS.sheet}
          </button>
        </header>
      )}
      <p className="plate-pull-live" aria-live="polite">
        {status}
      </p>
    </Root>
  );
}
