"use client";

import { useEffect, useRef, useState } from "react";

import "./caustics.css";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [marking, setMarking] = useState("deep end");

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      try {
        const { createCaustics } = await import("./causticsEngine");
        if (cancelled) return;
        engine = createCaustics({
          box: root,
          canvas,
          embedded,
          onReady: () => {
            if (!cancelled) setReady(true);
          },
          onText: (text) => {
            if (!cancelled) setMarking(text);
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
      className="caustics-root"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
      data-failed={failed ? "" : undefined}
    >
      <canvas
        ref={canvasRef}
        className="caustics-canvas"
        tabIndex={0}
        role="img"
        aria-label={`A sunlit pool seen from above, with “${marking}” set in dark tiles on the floor. Drag through the water to make ripples; type to change the words.`}
      />
      {embedded ? null : (
        <header className="caustics-head">
          <h1 className="caustics-title">Caustics</h1>
          <p className="caustics-lede">
            Sun on a pool. Drag through the water and the light folds into bright filaments that race across the tiles.
            <span className="caustics-type-hint"> Type to set your own words in the floor.</span>
          </p>
        </header>
      )}
      {failed ? <p className="caustics-fallback">This piece needs WebGL 2.</p> : null}
    </Root>
  );
}
