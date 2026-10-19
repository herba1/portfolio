"use client";

import { useEffect, useRef, useState } from "react";

import "./max-width.css";

function SpeakerIcon({ on }) {
  return (
    <svg className="max-width-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
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
  const stageRef = useRef(null);
  const controlsRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    const controls = controlsRef.current;
    if (!root || !stage || !controls) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createMaxWidth } = await import("./maxWidthEngine");
      if (cancelled) return;
      engine = createMaxWidth(root, { stage, controls, onReady: () => setReady(true) });
      engineRef.current = engine;
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

  const toggleSound = async () => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = !sound;
    setSound(next);
    const result = await engine.setSound(next);
    if (result !== next) setSound(false);
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root ref={rootRef} className="max-width" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      <div className="max-width-column">
        {embedded ? null : (
          <header className="max-width-caption">
            <div className="max-width-caption-text">
              <h1 className="max-width-title">Max Width</h1>
              <p className="max-width-hint">A promo for Abbey Road, cut on the beat. Drag the timeline to scrub any frame; arrow keys step, shift jumps keyframes.</p>
            </div>
            <button type="button" className="max-width-sound" aria-pressed={sound} onClick={toggleSound}>
              <SpeakerIcon on={sound} />
              <span>{sound ? "Sound on" : "Sound off"}</span>
            </button>
          </header>
        )}
        <div ref={stageRef} className="max-width-stage" aria-label="Abbey Road promo film" role="img" />
        <div ref={controlsRef} className="max-width-controls" />
      </div>
    </Root>
  );
}
