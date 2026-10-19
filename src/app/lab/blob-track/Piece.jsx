"use client";

import { useEffect, useRef, useState } from "react";

import photo from "./times-square.jpg";
import "./blob-track.css";

function SpeakerIcon({ on }) {
  return (
    <svg className="blob-track-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
      {on ? (
        <path d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.2 4a5.6 5.6 0 0 1 0 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M10.6 6.1l3.8 3.8M14.4 6.1l-3.8 3.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}

const THRESHOLD = { min: 0.5, max: 0.92, value: 0.72 };
const COUNT = { min: 4, max: 40, value: 22 };

export default function Piece({ embedded = false }) {
  const frameRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(false);
  const [threshold, setThreshold] = useState(THRESHOLD.value);
  const [count, setCount] = useState(COUNT.value);

  useEffect(() => {
    const frame = frameRef.current;
    const canvas = canvasRef.current;
    if (!frame || !canvas) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createTracker } = await import("./blobEngine");
      if (cancelled) return;
      engine = createTracker({ frame, canvas, src: photo.src, onReady: () => setReady(true) });
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
    io.observe(frame);
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

  const changeThreshold = (e) => {
    const v = Number(e.target.value);
    setThreshold(v);
    engineRef.current?.setThreshold(v);
  };

  const changeCount = (e) => {
    const v = Number(e.target.value);
    setCount(v);
    engineRef.current?.setCount(v);
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root className="blob-track" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      {embedded ? null : (
        <header className="blob-track-caption">
          <h1 className="blob-track-title">Tracking</h1>
          <p className="blob-track-hint">Every bright thing on the street gets a box and a number. Move over the frame and you are tracked too.</p>
        </header>
      )}
      <div
        ref={frameRef}
        className="blob-track-frame"
        tabIndex={0}
        role="img"
        aria-label="Times Square at night with live blob tracking boxes drawn over the bright signs, lights and people. Use the arrow keys to move the tracked pointer."
      >
        <canvas ref={canvasRef} className="blob-track-canvas" />
      </div>
      {embedded ? null : (
        <div className="blob-track-controls">
          <label className="blob-track-control">
            <span className="blob-track-control-row">
              <span>Threshold</span>
              <output className="blob-track-value">{threshold.toFixed(2)}</output>
            </span>
            <input type="range" min={THRESHOLD.min} max={THRESHOLD.max} step="0.01" value={threshold} onChange={changeThreshold} className="blob-track-range" />
          </label>
          <label className="blob-track-control">
            <span className="blob-track-control-row">
              <span>Boxes</span>
              <output className="blob-track-value">{count}</output>
            </span>
            <input type="range" min={COUNT.min} max={COUNT.max} step="1" value={count} onChange={changeCount} className="blob-track-range" />
          </label>
          <button type="button" className="blob-track-sound" aria-pressed={sound} onClick={toggleSound}>
            <SpeakerIcon on={sound} />
            <span>{sound ? "Blips on" : "Blips off"}</span>
          </button>
        </div>
      )}
    </Root>
  );
}
