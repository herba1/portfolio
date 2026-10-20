"use client";

import { useEffect, useRef, useState } from "react";

import "./dither.css";

function SpeakerIcon({ on }) {
  return (
    <svg className="dither-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
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
  const stageRef = useRef(null);
  const captionRef = useRef(null);
  const engineRef = useRef(null);
  const soundRef = useRef(false);
  const touchedRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(false);
  const [live, setLive] = useState("");

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    let cancelled = false;
    let engine = null;
    const applySound = async (next) => {
      const current = engineRef.current;
      if (!current) return;
      soundRef.current = next;
      setSound(next);
      const result = await current.setSound(next);
      if (result !== next) {
        soundRef.current = false;
        setSound(false);
      }
    };
    const onGesture = () => {
      if (touchedRef.current || soundRef.current) return;
      touchedRef.current = true;
      applySound(true);
    };
    const start = async () => {
      const { createDither } = await import("./ditherEngine");
      if (cancelled) return;
      engine = createDither(stage, { embedded, caption: captionRef.current, onLive: setLive, onGesture });
      engineRef.current = engine;
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
    io.observe(stage);
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
    touchedRef.current = true;
    const next = !soundRef.current;
    soundRef.current = next;
    setSound(next);
    const result = await engine.setSound(next);
    if (result !== next) {
      soundRef.current = false;
      setSound(false);
    }
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root className="dither" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      <div ref={stageRef} className="dither-stage">
        {embedded ? null : (
          <header ref={captionRef} className="dither-caption">
            <div className="dither-caption-text">
              <h1 className="dither-title">Dither</h1>
              <p className="dither-hint">Pick a record, then drag along the methods or across the cover to dissolve between ways of making it one bit.</p>
            </div>
            <button type="button" className="dither-sound" aria-pressed={sound} onClick={toggleSound}>
              <SpeakerIcon on={sound} />
              <span>{sound ? "Sound on" : "Sound off"}</span>
            </button>
          </header>
        )}
      </div>
            <p className="dither-live" aria-live="polite">
        {live}
      </p>
    </Root>
  );
}
