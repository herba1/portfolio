"use client";

import { useEffect, useRef, useState } from "react";

import "./lumen.css";

export default function Piece({ embedded = false }) {
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const layerRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [fixed, setFixed] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    const layer = layerRef.current;
    if (!stage || !canvas || !layer) return undefined;
    let cancelled = false;
    let engine = null;
    const onChange = (change) => {
      if (typeof change.fixed === "boolean") {
        setFixed(change.fixed);
        setStatus(change.fixed ? "The print is fixed. The sun can no longer change it." : "A fresh sheet of photo paper, already in the sun.");
      } else if (change.held) setStatus(`Holding the ${change.held.toLowerCase()}.`);
      else if (change.dropped) setStatus(`${change.dropped} set down ${change.onPaper ? "on the paper" : "on the table"}.`);
    };
    const start = async () => {
      try {
        const { createLumen } = await import("./lumenEngine");
        if (cancelled) return;
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        engine = createLumen(stage, canvas, layer, { reducedMotion, onChange });
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

  const Root = embedded ? "div" : "main";

  return (
    <Root className="lumen-root text-ink" data-embedded={embedded ? "" : undefined}>
      <div ref={stageRef} className="lumen-stage" data-ready={ready ? "" : undefined}>
        <canvas ref={canvasRef} className="lumen-canvas" aria-hidden="true" />
        <div ref={layerRef} className="lumen-layer" role="group" aria-label="Objects for the lumen print: a fern frond, a sprig of grass and a brass key. Drag them on and off the photo paper." />
        {failed ? <p className="lumen-fallback text-ui-lg">This piece needs WebGL 2.</p> : null}
      </div>
      {embedded ? null : (
        <header className="lumen-head">
          <h1 className="text-title-sm">Lumen Print</h1>
          <p className="lumen-hint text-ui-lg">Photo paper in the sun. Lift the fern or the key to see what they kept from the light, and lay things down to print them.</p>
          <button
            type="button"
            className="lumen-button"
            onClick={() => (fixed ? engineRef.current?.fresh() : engineRef.current?.fix())}
          >
            {fixed ? "New sheet" : "Fix the print"}
          </button>
        </header>
      )}
      <p className="lumen-live" aria-live="polite">
        {status}
      </p>
    </Root>
  );
}
