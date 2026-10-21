"use client";

import { useEffect, useRef, useState } from "react";

import "./steam.css";

const PALETTE = { ground: [17, 15, 14], steam: [238, 234, 228] };

const LINES = [
  "too hot to drink yet",
  "so i hold it with both hands",
  "and watch the street wake up",
  "nobody needs me for an hour",
  "this is the good part",
];

export default function Piece({ embedded = false }) {
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [line, setLine] = useState(LINES[0]);

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      try {
        const { createSteam } = await import("./steamEngine");
        if (cancelled) return;
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const made = await createSteam(stage, canvas, {
          reducedMotion,
          lines: LINES,
          palette: PALETTE,
          onLine: (text) => {
            if (!cancelled) setLine(text);
          },
        });
        if (cancelled) {
          made.destroy();
          return;
        }
        engine = made;
        engineRef.current = made;
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
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      engineRef.current?.blow(event.key === "ArrowRight" ? 1 : -1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      engineRef.current?.next();
    }
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root className="steam-root" data-embedded={embedded ? "" : undefined}>
      <div ref={stageRef} className="steam-stage" data-ready={ready ? "" : undefined}>
        <canvas
          ref={canvasRef}
          className="steam-canvas"
          tabIndex={0}
          role="img"
          aria-label="Words made of steam on a dark ground. Move across them to blow them apart; tap for the next line. With the keyboard, the left and right arrows blow from either side and Enter shows the next line."
          onKeyDown={onKeyDown}
        />
        {failed ? <p className="steam-fallback text-ui-lg">This piece needs WebGL.</p> : null}
      </div>
      {embedded ? null : (
        <header className="steam-head">
          <h1 className="text-title-sm">Steam</h1>
          <p className="steam-hint text-ui-lg">Blow across the words. Tap for the next line.</p>
        </header>
      )}
      <p className="steam-live" aria-live="polite">
        {line}
      </p>
    </Root>
  );
}
