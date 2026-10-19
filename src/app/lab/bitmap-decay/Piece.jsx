"use client";

import { useEffect, useRef, useState } from "react";

import "./bitmap-decay.css";

const START = "how are you?";

function SpeakerIcon({ on }) {
  return (
    <svg className="bitmap-decay-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
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
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(true);
  const [text, setText] = useState(START);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createDecay } = await import("./decayEngine");
      if (cancelled) return;
      engine = createDecay({ root, canvas: canvasRef.current, onChange: (s) => setDirty(s.dirty) });
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

  const onText = (e) => {
    const value = e.target.value.slice(0, 22);
    setText(value);
    engineRef.current?.setPhrase(value);
  };

  const reset = () => engineRef.current?.reset();

  const Root = embedded ? "div" : "main";

  return (
    <Root ref={rootRef} className="bitmap-decay" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      <canvas
        ref={canvasRef}
        className="bitmap-decay-canvas"
        tabIndex={0}
        role="img"
        aria-label={`"${text}" in blue bitmap type, four times, each line more broken. Drag a line down to decay it or up to heal it, scrub across to wear pixels away, hold still to mend them. Arrow keys pick a line and change its decay.`}
      />
      {embedded ? null : (
        <header className="bitmap-decay-caption">
          <div className="bitmap-decay-caption-text">
            <h1 className="bitmap-decay-title">How Are You</h1>
            <p className="bitmap-decay-hint">Drag a line down to break it, up to heal it. Scrub across to wear pixels off; hold still to mend them.</p>
          </div>
          <button type="button" className="bitmap-decay-sound" aria-pressed={sound} onClick={toggleSound}>
            <SpeakerIcon on={sound} />
            <span>{sound ? "Sound on" : "Sound off"}</span>
          </button>
        </header>
      )}
      <div className="bitmap-decay-bar">
        <label className="bitmap-decay-field">
          <span className="bitmap-decay-sr">Words</span>
          <input
            className="bitmap-decay-input"
            type="text"
            value={text}
            maxLength={22}
            spellCheck={false}
            autoComplete="off"
            enterKeyHint="done"
            onChange={onText}
            placeholder="type a line"
          />
        </label>
        <button type="button" className="bitmap-decay-reset" onClick={reset} disabled={!dirty}>
          Reset
        </button>
      </div>
    </Root>
  );
}
