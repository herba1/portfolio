"use client";

import { useEffect, useRef, useState } from "react";

import { GELS } from "./mirrorballGels";
import "./mirrorball.css";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const headRef = useRef(null);
  const engineRef = useRef(null);
  const gelRef = useRef(0);
  const [gel, setGel] = useState(0);
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
        const { createMirrorball } = await import("./mirrorballEngine");
        if (cancelled) return;
        engine = await createMirrorball({
          box: root,
          canvas,
          header: embedded ? null : headRef.current,
          embedded,
          gel: gelRef.current,
          onReady: () => {
            if (!cancelled) setReady(true);
          },
        });
        if (cancelled) {
          engine.destroy();
          return;
        }
        engineRef.current = engine;
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

  const choose = (idx) => {
    gelRef.current = idx;
    setGel(idx);
    engineRef.current?.setGel(idx);
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root
      ref={rootRef}
      className="mirrorball-root"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
      data-failed={failed ? "" : undefined}
    >
      <canvas
        ref={canvasRef}
        className="mirrorball-canvas"
        tabIndex={0}
        role="application"
        aria-label="A mirrorball hanging in a dark club, lit by one spotlight. Drag sideways to spin it; it keeps the speed of your throw and slows on its own. Left and right arrows push it, Space stops it."
      />
      {embedded ? null : (
        <header ref={headRef} className="mirrorball-head">
          <h1 className="mirrorball-title">Mirrorball</h1>
          <p className="mirrorball-lede">
            Give it a spin. Every mirror holds <em>a piece of the room</em> and throws its light back across the walls.
          </p>
        </header>
      )}
      {embedded ? null : (
        <div className="mirrorball-gels" role="radiogroup" aria-label="Spotlight gel">
          {GELS.map((g, i) => (
            <button
              key={g.key}
              type="button"
              role="radio"
              aria-checked={gel === i}
              className="mirrorball-gel"
              onClick={() => choose(i)}
            >
              <span className="mirrorball-swatch" style={{ "--mirrorball-swatch": g.swatch }} aria-hidden="true" />
              {g.label}
            </button>
          ))}
        </div>
      )}
      {failed ? <p className="mirrorball-fallback">This piece needs WebGL 2.</p> : null}
    </Root>
  );
}
