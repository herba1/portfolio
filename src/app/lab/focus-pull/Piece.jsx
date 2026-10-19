"use client";

import { useEffect, useRef, useState } from "react";

import { LYRIC } from "./focusEngine";
import "./focus-pull.css";

function SpeakerIcon({ on }) {
  return (
    <svg className="focus-pull-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
      {on ? (
        <path d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.2 4a5.6 5.6 0 0 1 0 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M10.6 6.1l3.8 3.8M14.4 6.1l-3.8 3.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const glRef = useRef(null);
  const ringRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [sound, setSound] = useState(true);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createFocus } = await import("./focusEngine");
      if (cancelled) return;
      engine = createFocus({ root, glCanvas: glRef.current, ring: ringRef.current, onFail: () => setFailed(true) });
      if (!engine) return;
      engineRef.current = engine;
      await engine.init();
      if (!cancelled) setReady(true);
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
  }, []);

  const toggleSound = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = !sound;
    setSound(next);
    const result = await engine.setSound(next);
    if (next && !result) setSound(false);
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root ref={rootRef} className="focus-pull" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      <canvas ref={glRef} className="focus-pull-gl" aria-hidden="true" />
      <p className="focus-pull-sr">{LYRIC.join(" ")}</p>
      <canvas
        ref={ringRef}
        className="focus-pull-ring"
        tabIndex={0}
        role="slider"
        aria-label="Focus ring"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={50}
        aria-valuetext="1.0 metres"
        aria-orientation="horizontal"
      />
      {embedded ? null : (
        <header className="focus-pull-caption">
          <div className="focus-pull-caption-text">
            <h1 className="focus-pull-title">Focus</h1>
            <p className="focus-pull-hint">Turn the ring to rack focus down the lines, or tap a line to focus on it. Red edges are what’s sharp.</p>
          </div>
          <button type="button" className="focus-pull-sound" aria-pressed={sound} onClick={toggleSound}>
            <SpeakerIcon on={sound} />
            <span>{sound ? "Sound on" : "Sound off"}</span>
          </button>
        </header>
      )}
      {failed ? <p className="focus-pull-fallback">This lens needs WebGL 2.</p> : null}
    </Root>
  );
}
