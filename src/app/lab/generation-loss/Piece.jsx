"use client";

import { useEffect, useRef, useState } from "react";

import "./generation-loss.css";

const START_TEXT = "still here?";
const START_GENERATIONS = 40;

function SpeakerIcon({ on }) {
  return (
    <svg className="generation-loss-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
      {on ? (
        <path d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.2 4a5.6 5.6 0 0 1 0 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M10.6 6.1l3.8 3.8M14.4 6.1l-3.8 3.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}

function formatKB(bytes) {
  if (!bytes) return "–";
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function Spark({ history }) {
  if (history.length < 2) return <svg className="generation-loss-spark" viewBox="0 0 96 24" aria-hidden="true" />;
  const max = Math.max(...history);
  const min = Math.min(...history);
  const span = Math.max(1, max - min);
  const points = history
    .map((b, i) => `${((i / (history.length - 1)) * 94 + 1).toFixed(2)},${(22 - ((b - min) / span) * 20).toFixed(2)}`)
    .join(" ");
  return (
    <svg className="generation-loss-spark" viewBox="0 0 96 24" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const ghostRef = useRef(null);
  const cardRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(true);
  const [text, setText] = useState(START_TEXT);
  const [quality, setQuality] = useState(32);
  const [state, setState] = useState({ generation: 0, bytes: 0, history: [] });

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createGeneration } = await import("./generationEngine");
      if (cancelled) return;
      engine = createGeneration({
        canvas: canvasRef.current,
        ghost: ghostRef.current,
        card: cardRef.current,
        onState: (s) => setState({ generation: s.generation, bytes: s.bytes, history: s.history }),
      });
      engineRef.current = engine;
      await engine.init(START_TEXT, START_GENERATIONS);
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
    const value = e.target.value.slice(0, 48);
    setText(value);
    engineRef.current?.setText(value.trim() ? value : " ");
  };

  const onQuality = (e) => {
    const value = Number(e.target.value);
    setQuality(value);
    engineRef.current?.setQuality(value / 100);
  };

  const onSaveDown = (e) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    engineRef.current?.hold(true);
  };

  const onSaveUp = () => engineRef.current?.hold(false);

  const onSaveClick = (e) => {
    if (e.detail === 0) engineRef.current?.save();
  };

  const onFieldKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      engineRef.current?.save();
    }
  };

  const reset = () => engineRef.current?.reset();

  const Root = embedded ? "div" : "main";

  return (
    <Root ref={rootRef} className="generation-loss" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      <div className="generation-loss-column">
        {embedded ? null : (
          <header className="generation-loss-caption">
            <div className="generation-loss-caption-text">
              <h1 className="generation-loss-title">Still Here</h1>
              <p className="generation-loss-hint">Every save is a real JPEG, re-encoded from the last one. Hold Save again and watch it wear.</p>
            </div>
            <button type="button" className="generation-loss-sound" aria-pressed={sound} onClick={toggleSound}>
              <SpeakerIcon on={sound} />
              <span>{sound ? "Sound on" : "Sound off"}</span>
            </button>
          </header>
        )}

        <figure ref={cardRef} className="generation-loss-card">
          <canvas ref={canvasRef} className="generation-loss-canvas" role="img" aria-label={`${text} saved as a JPEG ${state.generation} times`} />
          <canvas ref={ghostRef} className="generation-loss-ghost" aria-hidden="true" />
        </figure>

        <div className="generation-loss-readout">
          <span className="generation-loss-stat" aria-live="polite">
            <span className="generation-loss-stat-label">Generation</span>
            <span className="generation-loss-stat-value">{state.generation}</span>
          </span>
          <span className="generation-loss-stat">
            <span className="generation-loss-stat-label">File</span>
            <span className="generation-loss-stat-value">{formatKB(state.bytes)}</span>
            <Spark history={state.history.slice(1)} />
          </span>
          <label className="generation-loss-quality">
            <span className="generation-loss-quality-label">Quality</span>
            <input className="generation-loss-range" type="range" min="5" max="95" step="1" value={quality} onChange={onQuality} style={{ "--generation-loss-fill": `${((quality - 5) / 90) * 100}%` }} />
            <span className="generation-loss-quality-value">{quality}</span>
          </label>
        </div>

        <div className="generation-loss-controls">
          <label className="generation-loss-field">
            <span className="generation-loss-sr">Words</span>
            <input
              className="generation-loss-input"
              type="text"
              value={text}
              maxLength={48}
              spellCheck={false}
              autoComplete="off"
              enterKeyHint="done"
              onChange={onText}
              onKeyDown={onFieldKey}
              placeholder="type a line"
            />
          </label>
          <button type="button" className="generation-loss-reset" onClick={reset} disabled={state.generation === 0}>
            Reset
          </button>
          <button
            type="button"
            className="generation-loss-save"
            onPointerDown={onSaveDown}
            onPointerUp={onSaveUp}
            onPointerCancel={onSaveUp}
            onLostPointerCapture={onSaveUp}
            onClick={onSaveClick}
            onContextMenu={(e) => e.preventDefault()}
          >
            Save again
          </button>
        </div>
      </div>
    </Root>
  );
}
