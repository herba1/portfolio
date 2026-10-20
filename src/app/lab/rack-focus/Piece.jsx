"use client";

import { useEffect, useRef, useState } from "react";

import { MARKS, PHI_MAX } from "./rackScene";
import "./rack-focus.css";

const THIN = new Set([0.7, 1.2, 10]);
const MINOR = [0.65, 0.75, 0.9, 1.1, 1.35, 1.75, 2.5, 4, 7, 20];

function markLabel(d) {
  if (d === Infinity) return "∞";
  return String(d);
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const scaleRef = useRef(null);
  const stripRef = useRef(null);
  const readoutRef = useRef(null);
  const reticleRef = useRef(null);
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
        const { createRack } = await import("./rackEngine");
        if (cancelled) return;
        engine = createRack({
          box: root,
          canvas,
          scale: scaleRef.current,
          strip: stripRef.current,
          readout: readoutRef.current,
          reticle: reticleRef.current,
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
  const pos = (d) => ({ "--rack-at": (PHI_MAX - (d === Infinity ? 0 : 1 / d)).toFixed(4) });

  return (
    <Root
      ref={rootRef}
      className="rack-root"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
      data-failed={failed ? "" : undefined}
    >
      <canvas
        ref={canvasRef}
        className="rack-canvas"
        tabIndex={0}
        aria-label="A night street behind a line of white type. Tap the type or a light to pull focus to it, or drag up and down to rack focus."
      />
      <div ref={reticleRef} className="rack-reticle" aria-hidden="true" />
      <div className="rack-dock">
        <span className="rack-readout" aria-hidden="true">
          <span ref={readoutRef}>2.4 m</span>
        </span>
        <div
          ref={scaleRef}
          className="rack-scale"
          tabIndex={0}
          role="slider"
          aria-label="Focus distance"
          aria-valuemin={0}
          aria-valuemax={Number(PHI_MAX.toFixed(2))}
          aria-valuenow={0.42}
          aria-valuetext="Focused at 2.4 m"
        >
          <div ref={stripRef} className="rack-strip">
            {MINOR.map((d) => (
              <span key={`m${d}`} className="rack-tick rack-tick-minor" style={pos(d)} />
            ))}
            {MARKS.map((d) => (
              <span key={d} className="rack-mark" style={pos(d)} data-thin={THIN.has(d) ? "" : undefined}>
                <span className="rack-tick" />
                <span className="rack-num">{markLabel(d)}</span>
              </span>
            ))}
          </div>
          <span className="rack-index" />
        </div>
      </div>
      {embedded ? null : (
        <header className="rack-head">
          <h1 className="rack-title">Rack Focus</h1>
          <p className="rack-lede">
            A street at night behind one line of type. Tap a light or the words to pull focus to it, or turn the distance scale, and the city opens into <em>bokeh</em>.
          </p>
        </header>
      )}
      {failed ? <p className="rack-fallback">This piece needs WebGL 2.</p> : null}
    </Root>
  );
}
