"use client";

import { useEffect, useRef, useState } from "react";

import { POEM } from "./smearEngine";
import "./smear.css";

function SpeakerIcon({ on }) {
  return (
    <svg className="smear-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
      {on ? (
        <path d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.2 4a5.6 5.6 0 0 1 0 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M10.6 6.1l3.8 3.8M14.4 6.1l-3.8 3.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}

function ReplayIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M3.2 8a4.8 4.8 0 1 0 1.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M4.4 2.2v2.6H7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const LABEL = `A poem in small white type on black that keeps re-setting itself between a tight block and wide justified gaps. Drag across it to smear the words, press and hold or hold Space to scatter it, and let go to watch it set again line by line. Enter plays the arrival again. ${POEM.join(" / ")}`;

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const captionRef = useRef(null);
  const controlsRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(true);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createSmear } = await import("./smearEngine");
      if (cancelled) return;
      engine = createSmear(root, { stage: stageRef.current, caption: captionRef.current, controls: controlsRef.current }, { onReady: () => setReady(true) });
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

  const replay = () => engineRef.current?.replay();

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
    <Root ref={rootRef} className="smear" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      <div ref={stageRef} className="smear-stage" tabIndex={0} role="application" aria-roledescription="poem" aria-label={LABEL} />
      {embedded ? null : (
        <header ref={captionRef} className="smear-caption">
          <h1 className="smear-title">Smear</h1>
          <p className="smear-hint">Drag across the poem to smear it, or hold to scatter it. Left alone, it keeps re-setting itself.</p>
        </header>
      )}
      <div ref={controlsRef} className="smear-controls">
        <button type="button" className="smear-button" onClick={replay}>
          <ReplayIcon />
          <span>Play again</span>
        </button>
        {embedded ? null : (
          <button type="button" className="smear-sound" aria-pressed={sound} onClick={toggleSound} aria-label={sound ? "Sound on" : "Sound off"}>
            <SpeakerIcon on={sound} />
          </button>
        )}
      </div>
    </Root>
  );
}
