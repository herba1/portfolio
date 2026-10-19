"use client";

import { useEffect, useRef, useState } from "react";

import street from "./street.jpg";
import "./stretch.css";

function SpeakerIcon({ on }) {
  return (
    <svg className="stretch-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
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
  const inputRef = useRef(null);
  const caretRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(false);
  const [live, setLive] = useState("");

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createStretch } = await import("./stretchEngine");
      if (cancelled) return;
      engine = createStretch(stage, { image: street.src, input: inputRef.current, caret: caretRef.current, onLive: setLive });
      engineRef.current = engine;
      await engine.ready;
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
    io.observe(stage);
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
    if (result !== next) setSound(false);
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root className="stretch" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      <div ref={stageRef} className="stretch-stage">
        <input
          ref={inputRef}
          className="stretch-input"
          type="text"
          aria-label="The line"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={28}
          defaultValue="to run away"
        />
        <div ref={caretRef} className="stretch-caret" aria-hidden="true" />
        {embedded ? null : (
          <header className="stretch-caption">
            <div className="stretch-caption-text">
              <h1 className="stretch-title">Stretch</h1>
              <p className="stretch-hint stretch-hint-fine">Grab a letter and pull it. Flick to make it stay, Esc lets go. Type to change the line.</p>
              <p className="stretch-hint stretch-hint-touch">Pull a letter down or up. Flick to make it stay. Tap the street to type.</p>
            </div>
            <button type="button" className="stretch-sound" aria-pressed={sound} onClick={toggleSound}>
              <SpeakerIcon on={sound} />
              <span>{sound ? "Sound on" : "Sound off"}</span>
            </button>
          </header>
        )}
      </div>
      <p className="stretch-live" aria-live="polite">
        {live}
      </p>
    </Root>
  );
}
