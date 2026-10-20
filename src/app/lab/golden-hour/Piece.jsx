"use client";

import { useEffect, useRef, useState } from "react";

import "./golden-hour.css";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const dialRef = useRef(null);
  const sunRef = useRef(null);
  const readoutRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      try {
        const { createGoldenHour } = await import("./goldenEngine");
        if (cancelled) return;
        engine = createGoldenHour({
          box: root,
          canvas,
          dial: dialRef.current,
          sun: sunRef.current,
          readout: readoutRef.current,
          embedded,
          onReady: () => {
            if (!cancelled) setReady(true);
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
      engine?.destroy();
    };
  }, [embedded]);

  const Root = embedded ? "div" : "main";

  return (
    <Root
      ref={rootRef}
      className="golden-root"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
      data-failed={failed ? "" : undefined}
    >
      <canvas
        ref={canvasRef}
        className="golden-canvas"
        role="img"
        aria-label="A clay bottle, a cup and an orange on a table against a plaster wall, lit through a window. Drag sideways to move the time of day."
      />
      <div className="golden-dock">
        <svg
          ref={dialRef}
          className="golden-dial"
          viewBox="0 0 88 64"
          role="slider"
          tabIndex={0}
          aria-label="Time of day"
          aria-valuemin={0}
          aria-valuemax={1439}
          aria-valuenow={0}
          aria-valuetext=""
        >
          <circle className="golden-dial-track" cx="44" cy="36" r="24" />
          <line className="golden-dial-horizon" x1="4" y1="36" x2="84" y2="36" />
          <circle ref={sunRef} className="golden-dial-sun" cx="20" cy="36" r="6" />
        </svg>
        <span ref={readoutRef} className="golden-readout" aria-hidden="true" />
      </div>
      {embedded ? null : (
        <header className="golden-head">
          <h1 className="golden-title">Golden Hour</h1>
          <p className="golden-lede">
            Drag across the room, or turn the dial, to move the sun. The light through the window climbs the wall as the day goes <em>long</em>, and the shadows change colour with it.
          </p>
        </header>
      )}
      {failed ? <p className="golden-fallback">This piece needs WebGL 2.</p> : null}
    </Root>
  );
}
