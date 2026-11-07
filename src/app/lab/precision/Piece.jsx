"use client";

import { useEffect, useRef, useState } from "react";

import "./precision.css";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const readoutRef = useRef(null);
  const wholeRef = useRef(null);
  const fracRef = useRef(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createPrecision } = await import("./precisionEngine");
      if (cancelled) return;
      engine = createPrecision(root, {
        embedded,
        stage: stageRef.current,
        canvas: canvasRef.current,
        readout: readoutRef.current,
        whole: wholeRef.current,
        frac: fracRef.current,
      });
      setReady(true);
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
      className="pr-root"
      data-ready={ready ? "" : undefined}
      role="slider"
      tabIndex={0}
      aria-label="Playback position"
      aria-valuemin={0}
      aria-valuemax={247}
      aria-valuenow={72}
      aria-valuetext="1 minute 12 seconds"
    >
      <div ref={stageRef} className="pr-stage">
        <div ref={readoutRef} className="pr-readout" aria-hidden="true">
          <span ref={wholeRef} className="pr-whole">
            1:12
          </span>
          <span ref={fracRef} className="pr-frac">
            <span className="pr-frac-inner">.00</span>
          </span>
        </div>
        <canvas ref={canvasRef} className="pr-canvas" aria-hidden="true" />
      </div>
    </Root>
  );
}
