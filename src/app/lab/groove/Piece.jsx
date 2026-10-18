"use client";

import { useEffect, useRef, useState } from "react";

import { PRESETS } from "./groovePresets";
import "./groove.css";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const headRef = useRef(null);
  const pickRef = useRef(null);
  const engineRef = useRef(null);
  const presetRef = useRef(0);
  const [preset, setPreset] = useState(0);
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
        const { createGroove } = await import("./grooveEngine");
        if (cancelled) return;
        engine = createGroove({
          box: root,
          canvas,
          header: embedded ? null : headRef.current,
          picker: embedded ? null : pickRef.current,
          embedded,
          preset: presetRef.current,
          onReady: () => {
            if (!cancelled) setReady(true);
          },
        });
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
    presetRef.current = idx;
    setPreset(idx);
    engineRef.current?.setPreset(idx);
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root
      ref={rootRef}
      className="groove-root"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
    >
      <canvas
        ref={canvasRef}
        className="groove-canvas"
        tabIndex={0}
        role="application"
        aria-label={`${PRESETS[preset].title} by ${PRESETS[preset].artist}, its cover etched into the grooves of a black record and printed on the label, lit by one lamp. The cover only shows where the groove sheen catches the light. Drag the record to spin it; it keeps the speed of your throw. Move the pointer to move the lamp. Left and right arrows push the record, Space stops it.`}
      />
      {embedded ? null : (
        <header ref={headRef} className="groove-head">
          <h1 className="groove-title">Groove</h1>
          <p className="groove-lede">
            A Beatles cover cut into black vinyl. Spin it under the lamp and the sleeve <em>surfaces in the sheen</em>.
          </p>
        </header>
      )}
      {embedded ? null : (
        <div ref={pickRef} className="groove-pick" role="radiogroup" aria-label="Pressing">
          {PRESETS.map((p, i) => (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={preset === i}
              aria-label={p.title}
              className="groove-chip"
              onClick={() => choose(i)}
            >
              <span className="groove-thumb" style={{ backgroundImage: `url(${p.src})` }} aria-hidden="true" />
              <span className="groove-chip-name">{p.label}</span>
            </button>
          ))}
        </div>
      )}
      {failed ? <p className="groove-fallback">This record needs WebGL 2.</p> : null}
    </Root>
  );
}
