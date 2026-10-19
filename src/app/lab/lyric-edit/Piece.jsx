"use client";

import { useEffect, useRef, useState } from "react";

import footage from "./times-square.jpg";
import "./lyric-edit.css";

function SpeakerIcon({ on }) {
  return (
    <svg className="lyric-edit-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
      {on ? (
        <path d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.2 4a5.6 5.6 0 0 1 0 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M10.6 6.1l3.8 3.8M14.4 6.1l-3.8 3.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}

function ReplayIcon() {
  return (
    <svg className="lyric-edit-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M3.2 8a4.8 4.8 0 1 0 1.5-3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" fill="none" />
      <path d="M4.4 1.9v2.9h2.9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

const MODE_LABEL = { demo: "Demo edit", rec: "Recording", take: "Your edit" };

export default function Piece({ embedded = false }) {
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const marksRef = useRef(null);
  const headRef = useRef(null);
  const readoutRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(false);
  const [mode, setMode] = useState("demo");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createLyricEngine } = await import("./lyricEngine");
      if (cancelled) return;
      engine = createLyricEngine({
        stage,
        canvas: canvasRef.current,
        marks: marksRef.current,
        head: headRef.current,
        readout: readoutRef.current,
        embedded,
        imageSrc: footage.src,
        onMode: setMode,
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

  const replay = () => engineRef.current?.replay();

  const Root = embedded ? "div" : "main";

  return (
    <Root className="lyric-edit" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      <div ref={stageRef} className="lyric-edit-stage">
        <canvas ref={canvasRef} className="lyric-edit-canvas" aria-hidden="true" />
        <div className="lyric-edit-shade" aria-hidden="true" />
        {embedded ? null : (
          <header className="lyric-edit-caption" data-lyric-edit-chrome="">
            <div className="lyric-edit-caption-text">
              <h1 className="lyric-edit-title">Lyric Edit</h1>
              <p className="lyric-edit-hint">Tap the frame on the beat to drop the next word. Space works too.</p>
            </div>
            <button type="button" className="lyric-edit-button" aria-pressed={sound} onClick={toggleSound}>
              <SpeakerIcon on={sound} />
              <span>{sound ? "Beat on" : "Beat off"}</span>
            </button>
          </header>
        )}
        <footer className="lyric-edit-timeline" data-lyric-edit-chrome="">
          {embedded ? null : (
            <button type="button" className="lyric-edit-button" onClick={replay}>
              <ReplayIcon />
              <span>Replay</span>
            </button>
          )}
          <div className="lyric-edit-track">
            <div ref={marksRef} className="lyric-edit-marks" />
            <div ref={headRef} className="lyric-edit-head" />
          </div>
          <div className="lyric-edit-status" data-mode={mode}>
            <span className="lyric-edit-dot" aria-hidden="true" />
            <span className="lyric-edit-mode">{MODE_LABEL[mode]}</span>
            <span ref={readoutRef} className="lyric-edit-time">
              0:03
            </span>
          </div>
        </footer>
      </div>
      {failed ? <p className="lyric-edit-fallback">This edit needs WebGL 2.</p> : null}
    </Root>
  );
}
