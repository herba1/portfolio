"use client";

import { useEffect, useRef, useState } from "react";

import "./generation-loss.css";

const START_TEXT = "still here?";

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

function Spark({ history, total }) {
  if (history.length < 2) return <svg className="generation-loss-spark" viewBox="0 0 96 24" aria-hidden="true" />;
  const max = Math.max(...history);
  const min = Math.min(...history);
  const span = Math.max(1, max - min);
  const points = history
    .map((b, i) => `${((i / Math.max(1, total - 1)) * 94 + 1).toFixed(2)},${(22 - ((b - min) / span) * 20).toFixed(2)}`)
    .join(" ");
  return (
    <svg className="generation-loss-spark" viewBox="0 0 96 24" aria-hidden="true">
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function PlayIcon({ playing }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      {playing ? <path d="M4.5 3h2.4v10H4.5zM9.1 3h2.4v10H9.1z" fill="currentColor" /> : <path d="M5 2.8v10.4L13.2 8z" fill="currentColor" />}
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
  const [quality, setQuality] = useState(18);
  const [state, setState] = useState({ generation: 0, bytes: 0, history: [], playing: true });
  const [max, setMax] = useState(100);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let engine = null;
    let onScreen = true;
    const applyVisible = () => engine?.setVisible(onScreen && document.visibilityState === "visible");
    const start = async () => {
      const { createGeneration, MAX_GENERATIONS } = await import("./generationEngine");
      if (cancelled) return;
      setMax(MAX_GENERATIONS);
      engine = createGeneration({
        canvas: canvasRef.current,
        ghost: ghostRef.current,
        card: cardRef.current,
        onState: (s) => setState({ generation: s.generation, bytes: s.bytes, history: s.history, playing: s.playing }),
      });
      engineRef.current = engine;
      await engine.init(START_TEXT);
      if (cancelled) return;
      applyVisible();
      setReady(true);
    };
    let begun = false;
    const io = new IntersectionObserver(
      ([entry]) => {
        onScreen = entry.isIntersecting;
        if (onScreen && !begun) {
          begun = true;
          start();
        }
        applyVisible();
      },
      { rootMargin: "240px" },
    );
    io.observe(root);
    document.addEventListener("visibilitychange", applyVisible);
    return () => {
      cancelled = true;
      io.disconnect();
      document.removeEventListener("visibilitychange", applyVisible);
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

  const onScrub = (e) => engineRef.current?.scrub(Number(e.target.value));

  const togglePlay = () => engineRef.current?.setPlaying(!state.playing);

  const onFieldKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };

  const Root = embedded ? "div" : "main";
  const fill = `${(state.generation / max) * 100}%`;

  return (
    <Root ref={rootRef} className="generation-loss" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      <div className="generation-loss-column">
        {embedded ? null : (
          <header className="generation-loss-caption">
            <div className="generation-loss-caption-text">
              <h1 className="generation-loss-title">Still Here</h1>
              <p className="generation-loss-hint">A line saved as a JPEG over and over, each copy made from the last. Type your own, or drag the generations.</p>
            </div>
            <button type="button" className="generation-loss-sound" aria-pressed={sound} onClick={toggleSound}>
              <SpeakerIcon on={sound} />
              <span>{sound ? "Sound on" : "Sound off"}</span>
            </button>
          </header>
        )}

        <figure ref={cardRef} className="generation-loss-card" onClick={togglePlay}>
          <canvas ref={canvasRef} className="generation-loss-canvas" role="img" aria-label={`${text} saved as a JPEG ${state.generation} times`} />
          <canvas ref={ghostRef} className="generation-loss-ghost" aria-hidden="true" />
        </figure>

        <label className="generation-loss-scrub">
          <span className="generation-loss-stat-label">Generation</span>
          <input
            className="generation-loss-range generation-loss-range-wide"
            type="range"
            min="0"
            max={max}
            step="1"
            value={state.generation}
            onChange={onScrub}
            style={{ "--generation-loss-fill": fill }}
          />
          <span className="generation-loss-stat-value generation-loss-count">{state.generation}</span>
        </label>

        <div className="generation-loss-readout">
          <span className="generation-loss-stat">
            <span className="generation-loss-stat-label">File</span>
            <span className="generation-loss-stat-value">{formatKB(state.bytes)}</span>
            <Spark history={state.history} total={max} />
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
          <button type="button" className="generation-loss-save" aria-pressed={!state.playing} onClick={togglePlay}>
            <PlayIcon playing={state.playing} />
            <span>{state.playing ? "Pause" : "Play"}</span>
          </button>
        </div>
      </div>
    </Root>
  );
}
