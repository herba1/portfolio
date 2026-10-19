"use client";

import { useEffect, useRef, useState } from "react";

import "./crayon.css";

function SpeakerIcon({ on }) {
  return (
    <svg className="crayon-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
      {on ? (
        <path d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.2 4a5.6 5.6 0 0 1 0 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M10.6 6.1l3.8 3.8M14.4 6.1l-3.8 3.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}

function CrayonIcon() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M3.2 12.8 4 9.6l6.6-6.6a1.4 1.4 0 0 1 2 0l.4.4a1.4 1.4 0 0 1 0 2L6.4 12z" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M9.2 4.4l2.4 2.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const panelRef = useRef(null);
  const paperRef = useRef(null);
  const inkRef = useRef(null);
  const ghostRef = useRef(null);
  const orangesRef = useRef(null);
  const inputRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(true);

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createCrayon } = await import("./crayonEngine");
      if (cancelled) return;
      engine = createCrayon({
        root: rootRef.current,
        panel,
        paperCanvas: paperRef.current,
        inkCanvas: inkRef.current,
        ghostCanvas: ghostRef.current,
        orangeLayer: orangesRef.current,
        input: inputRef.current,
        embedded,
        onReady: () => setReady(true),
      });
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
    io.observe(panel);
    return () => {
      cancelled = true;
      io.disconnect();
      engine?.destroy();
      engineRef.current = null;
    };
  }, [embedded]);

  const toggleSound = async () => {
    const next = !sound;
    setSound(next);
    const engine = engineRef.current;
    if (!engine) return;
    const result = await engine.setSound(next);
    if (next && !result) setSound(false);
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root ref={rootRef} className="crayon" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      {embedded ? null : (
        <header className="crayon-caption">
          <div className="crayon-caption-text">
            <h1 className="crayon-title">Crayon</h1>
            <p className="crayon-hint">Type and it gets lettered in white crayon, one stroke at a time. Backspace rubs a letter out; the oranges can be moved.</p>
          </div>
          <div className="crayon-actions">
            <button type="button" className="crayon-button" onPointerDown={(e) => e.preventDefault()} onClick={() => engineRef.current?.write()}>
              <CrayonIcon />
              <span>Write</span>
            </button>
            <button type="button" className="crayon-button" onPointerDown={(e) => e.preventDefault()} onClick={() => engineRef.current?.clear()}>
              <span>Clear</span>
            </button>
            <button type="button" className="crayon-button" aria-pressed={sound} onClick={toggleSound}>
              <SpeakerIcon on={sound} />
              <span>{sound ? "Sound on" : "Sound off"}</span>
            </button>
          </div>
        </header>
      )}
      <div className="crayon-desk">
        <div ref={panelRef} className="crayon-panel">
          <canvas ref={paperRef} className="crayon-canvas" aria-hidden="true" />
          <div ref={orangesRef} className="crayon-oranges" />
          <canvas ref={ghostRef} className="crayon-canvas crayon-ghost" aria-hidden="true" />
          <canvas ref={inkRef} className="crayon-canvas crayon-ink" aria-hidden="true" />
        </div>
      </div>
      <textarea
        ref={inputRef}
        className="crayon-input"
        maxLength={180}
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="characters"
        spellCheck={false}
        aria-label="Type to letter in crayon"
      />
    </Root>
  );
}
