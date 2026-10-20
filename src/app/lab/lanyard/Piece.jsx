"use client";

import { useEffect, useRef, useState } from "react";

import "./lanyard.css";

const NUDGE = 3.2;

export default function Piece({ embedded = false }) {
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [side, setSide] = useState("front");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return undefined;
    let cancelled = false;
    let engine = null;
    const onChange = (change) => {
      if (change.side) {
        setSide(change.side);
        setStatus(change.side === "back" ? "Turned over. The back lists the pieces it admits you to." : "Turned back to the front.");
      }
    };
    const start = async () => {
      try {
        const { createLanyard } = await import("./lanyardEngine");
        if (cancelled) return;
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        engine = await createLanyard(stage, canvas, { embedded, reducedMotion, onChange });
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
    const engine = engineRef.current;
    if (!engine) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      engine.flip();
      return;
    }
    const moves = { ArrowLeft: [-NUDGE, 0], ArrowRight: [NUDGE, 0], ArrowUp: [0, NUDGE * 1.4], ArrowDown: [0, -NUDGE] };
    const move = moves[event.key];
    if (move) {
      event.preventDefault();
      engine.nudge(move[0], move[1]);
    }
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root className="lanyard-root text-ink" data-embedded={embedded ? "" : undefined}>
      <div ref={stageRef} className="lanyard-stage" data-ready={ready ? "" : undefined}>
        <canvas
          ref={canvasRef}
          className="lanyard-canvas"
          tabIndex={0}
          role="application"
          aria-label={`A herb.art lab pass hanging on a woven strap, showing its ${side}. Drag it to swing and throw it; it turns back to face you. Arrow keys push it, Enter turns it over.`}
          onKeyDown={onKeyDown}
        />
        {failed ? <p className="lanyard-fallback text-ui-lg">This piece needs WebGL.</p> : null}
      </div>
      {embedded ? null : (
        <header className="lanyard-head">
          <h1 className="text-title-sm">Lanyard</h1>
          <p className="lanyard-hint text-ui-lg">Grab the pass and throw it. However it lands, it turns back to face you.</p>
          <button type="button" className="lanyard-button" onClick={() => engineRef.current?.flip()}>
            {side === "front" ? "Turn over" : "Turn to front"}
          </button>
        </header>
      )}
      <p className="lanyard-live" aria-live="polite">
        {status}
      </p>
    </Root>
  );
}
