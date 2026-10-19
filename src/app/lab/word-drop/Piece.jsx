"use client";

import { useEffect, useRef, useState } from "react";

import catchShot from "./catch.jpg";
import seaShot from "./sea.jpg";
import shoreShot from "./shore.jpg";
import "./word-drop.css";

const SHOTS = [
  { src: catchShot.src, focus: [0.56, 0.4], zoom: 1 },
  { src: shoreShot.src, focus: [0.6, 0.2], zoom: 1 },
  { src: seaShot.src, focus: [0.5, 0.5], zoom: 1 },
  { src: catchShot.src, focus: [0.62, 0.3], zoom: 1.45 },
];

function SpeakerIcon({ on }) {
  return (
    <svg className="word-drop-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
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
  const canvasRef = useRef(null);
  const layerRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(false);
  const [state, setState] = useState({ next: null, phrase: 0, total: 4, done: false });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createWordEngine } = await import("./wordEngine");
      if (cancelled) return;
      engine = createWordEngine({
        stage,
        canvas: canvasRef.current,
        layer: layerRef.current,
        shots: SHOTS,
        embedded,
        onState: setState,
        onSound: setSound,
        onReady: () => setReady(true),
        onFail: () => setFailed(true),
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
    const next = !sound;
    setSound(next);
    const result = await engine.setSound(next);
    if (result !== next) setSound(result);
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root className="word-drop" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      <div ref={stageRef} className="word-drop-stage">
        <canvas ref={canvasRef} className="word-drop-canvas" aria-hidden="true" />
        <div ref={layerRef} className="word-drop-layer" aria-hidden="true" />
        <div className="word-drop-shade" aria-hidden="true" />
        {embedded ? null : (
          <header className="word-drop-caption" data-word-drop-chrome="">
            <div className="word-drop-caption-text">
              <h1 className="word-drop-title">Word Drop</h1>
              <p className="word-drop-hint">Tap anywhere on the shot to put the next word there. Finish the line and the next tap cuts.</p>
            </div>
            <button type="button" className="word-drop-button" aria-pressed={sound} onClick={toggleSound}>
              <SpeakerIcon on={sound} />
              <span>{sound ? "Sound on" : "Sound off"}</span>
            </button>
          </header>
        )}
        {embedded ? null : (
          <footer className="word-drop-status" data-word-drop-chrome="" aria-live="polite">
            <span className="word-drop-shot">
              Shot {state.phrase + 1} of {state.total}
            </span>
            <span className="word-drop-next">
              {state.done ? (
                "Next tap cuts"
              ) : (
                <>
                  Next word <b className="word-drop-chip">{state.next}</b>
                </>
              )}
            </span>
          </footer>
        )}
      </div>
      {failed ? <p className="word-drop-fallback">This piece needs WebGL 2.</p> : null}
    </Root>
  );
}
