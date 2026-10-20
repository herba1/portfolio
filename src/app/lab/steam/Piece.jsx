"use client";

import { useEffect, useRef, useState } from "react";

import "./steam.css";

const PALETTE = { ground: [92, 80, 72], light: [230, 222, 210] };

export default function Piece({ embedded = false }) {
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

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
        engine = createSteam(stage, canvas, { reducedMotion, palette: PALETTE });
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
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      engineRef.current?.blow(event.key === "ArrowRight" ? 1 : -1);
    }
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root className="steam-root text-ink" data-embedded={embedded ? "" : undefined}>
      <div ref={stageRef} className="steam-stage" data-ready={ready ? "" : undefined}>
        <canvas
          ref={canvasRef}
          className="steam-canvas"
          tabIndex={0}
          role="img"
          aria-label="A cup of black coffee on a saucer, steaming in the morning light. Move across the steam to blow it aside; with the keyboard, the left and right arrows blow from either side."
          onKeyDown={onKeyDown}
        />
        {failed ? <p className="steam-fallback text-ui-lg">This piece needs WebGL.</p> : null}
      </div>
      {embedded ? null : (
        <header className="steam-head">
          <h1 className="text-title-sm">Steam</h1>
          <p className="steam-hint text-ui-lg">Too hot to drink yet. Blow across it.</p>
        </header>
      )}
    </Root>
  );
}
