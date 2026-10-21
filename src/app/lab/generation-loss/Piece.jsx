"use client";

import { useEffect, useRef, useState } from "react";

import "./generation-loss.css";

const START_TEXT = "still here?";

function formatKB(bytes) {
  if (!bytes) return "–";
  return `${(bytes / 1024).toFixed(1)} KB`;
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
  const [dragging, setDragging] = useState(null);
  const dragRef = useRef(null);

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
        // In a tile, only a touch on the piece arms its shutter sound.
        gestureScope: embedded ? root : window,
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
  }, [embedded]);

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

  const applyQuality = (value) => {
    const next = Math.max(5, Math.min(95, Math.round(value)));
    setQuality(next);
    engineRef.current?.setQuality(next / 100);
  };

  const togglePlay = () => engineRef.current?.setPlaying(!state.playing);

  const onCardDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const box = e.currentTarget.getBoundingClientRect();
    dragRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, w: box.width, h: box.height, gen: state.generation, quality, axis: null };
  };

  const onCardMove = (e) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== e.pointerId) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.axis) {
      if (Math.hypot(dx, dy) < 6) return;
      drag.axis = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
      setDragging(drag.axis);
    }
    if (drag.axis === "x") engineRef.current?.scrub(drag.gen + (dx / drag.w) * max * 1.2);
    else applyQuality(drag.quality - (dy / drag.h) * 120);
  };

  const onCardUp = (e) => {
    const drag = dragRef.current;
    if (!drag || drag.id !== e.pointerId) return;
    dragRef.current = null;
    setDragging(null);
    if (!drag.axis && e.type === "pointerup") togglePlay();
  };

  const onCardKey = (e) => {
    const engine = engineRef.current;
    if (!engine) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      togglePlay();
    } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      engine.scrub(state.generation + (e.key === "ArrowRight" ? 1 : -1) * (e.shiftKey ? 10 : 1));
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      applyQuality(quality + (e.key === "ArrowUp" ? 5 : -5));
    }
  };

  const onFieldKey = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.currentTarget.blur();
    }
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root ref={rootRef} className="generation-loss" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      <div className="generation-loss-column">
        {embedded ? null : (
          <header className="generation-loss-caption">
            <div className="generation-loss-caption-text">
              <h1 className="generation-loss-title">Still Here</h1>
              <p className="generation-loss-hint">A line saved as a JPEG over and over, each copy made from the last. Drag across the picture to go through the copies, tap it to hold, rename the file to change the line.</p>
            </div>
            <button type="button" className="generation-loss-sound" aria-pressed={sound} onClick={toggleSound}>
              {sound ? "sound" : "quiet"}
            </button>
          </header>
        )}

        <figure
          ref={cardRef}
          className="generation-loss-card"
          tabIndex={0}
          role="slider"
          aria-label="Copies. Drag sideways to go through them, up and down for quality, tap to pause."
          aria-valuemin={0}
          aria-valuemax={max}
          aria-valuenow={state.generation}
          aria-valuetext={`copy ${state.generation}, quality ${quality}`}
          data-dragging={dragging || undefined}
          onPointerDown={onCardDown}
          onPointerMove={onCardMove}
          onPointerUp={onCardUp}
          onPointerCancel={onCardUp}
          onKeyDown={onCardKey}
        >
          <canvas ref={canvasRef} className="generation-loss-canvas" role="img" aria-label={`${text} saved as a JPEG ${state.generation} times`} />
          <canvas ref={ghostRef} className="generation-loss-ghost" aria-hidden="true" />
        </figure>

        <p className="generation-loss-file">
          <label className="generation-loss-name">
            <span className="generation-loss-sr">Words</span>
            <input
              className="generation-loss-input"
              type="text"
              value={text}
              maxLength={48}
              size={Math.max(4, text.length + 1)}
              spellCheck={false}
              autoComplete="off"
              enterKeyHint="done"
              onChange={onText}
              onKeyDown={onFieldKey}
              placeholder="type a line"
            />
            <span className="generation-loss-ext">.jpg</span>
          </label>
          <span className="generation-loss-meta" data-axis={dragging || undefined}>
            <span className="generation-loss-copy">{dragging === "y" ? `quality ${quality}` : `${state.playing ? "copy" : "held at copy"} ${state.generation}`}</span>
            <span className="generation-loss-size">{formatKB(state.bytes)}</span>
          </span>
        </p>
      </div>
    </Root>
  );
}
