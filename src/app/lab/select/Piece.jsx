"use client";

import { useEffect, useRef, useState } from "react";

import "./select.css";

function SpeakerIcon({ on }) {
  return (
    <svg className="select-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
      {on ? (
        <path d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.2 4a5.6 5.6 0 0 1 0 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M10.6 6.1l3.8 3.8M14.4 6.1l-3.8 3.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}

const LABEL =
  "A lyric paragraph with a text selection. Drag a selection handle, or drag across the words, and the selected run lifts off the line and slides down its tilted highlight. Let go and it snaps back, then choose Copy, Look Up or Share. Shift and the arrow keys extend the selection, the arrow keys move it, Command or Control C copies.";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const captionRef = useRef(null);
  const engineRef = useRef(null);
  const [sound, setSound] = useState(true);
  const [copied, setCopied] = useState("");

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createSelect } = await import("./selectEngine");
      if (cancelled) return;
      engine = createSelect(root, { stage: stageRef.current, caption: captionRef.current }, { onCopy: (text) => setCopied(`Copied ${text}`) });
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
    <Root ref={rootRef} className="select" data-embedded={embedded ? "" : undefined}>
      <div ref={stageRef} className="select-stage" tabIndex={0} role="application" aria-roledescription="text selection" aria-label={LABEL} />
      {embedded ? null : (
        <header ref={captionRef} className="select-caption">
          <div className="select-caption-text">
            <h1 className="select-title">Selection</h1>
            <p className="select-hint">Drag a blue handle and the selection lifts off the line. Let go to copy, look up or share it.</p>
          </div>
          <button type="button" className="select-sound" aria-pressed={sound} onClick={toggleSound} aria-label={sound ? "Sound on" : "Sound off"}>
            <SpeakerIcon on={sound} />
          </button>
        </header>
      )}
      <p className="select-live" aria-live="polite">
        {copied}
      </p>
    </Root>
  );
}
