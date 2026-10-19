"use client";

import { useEffect, useRef, useState } from "react";

import "./disc.css";

const SEGS = {
  a: "2,0.8 10,0.8 8.6,2.4 3.4,2.4",
  b: "10.4,1.2 10.4,9.4 9.6,10 8.8,9.2 8.8,2.8",
  c: "10.4,10.6 10.4,18.8 8.8,17.2 8.8,10.8 9.6,10",
  d: "3.4,17.6 8.6,17.6 10,19.2 2,19.2",
  e: "1.6,10.6 2.4,10 3.2,10.8 3.2,17.2 1.6,18.8",
  f: "1.6,1.2 3.2,2.8 3.2,9.2 2.4,10 1.6,9.4",
  g: "2.6,10 3.4,9.2 8.6,9.2 9.4,10 8.6,10.8 3.4,10.8",
};

function Digit() {
  return (
    <svg className="disc-digit" viewBox="0 0 12 20" data-disc-digit="" aria-hidden="true">
      {Object.entries(SEGS).map(([key, points]) => (
        <polygon key={key} data-seg={key} points={points} />
      ))}
    </svg>
  );
}

function SpeakerIcon({ on }) {
  return (
    <svg className="disc-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
      {on ? (
        <path d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.2 4a5.6 5.6 0 0 1 0 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M10.6 6.1l3.8 3.8M14.4 6.1l-3.8 3.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}

function KeyIcon({ name }) {
  if (name === "open") return <path d="M8 3.4 12.6 9H3.4zM3.4 10.8h9.2v1.8H3.4z" />;
  if (name === "prev") return <path d="M3.6 3.6h1.8v8.8H3.6zM12.6 3.6v8.8L6 8z" />;
  if (name === "next") return <path d="M10.6 3.6h1.8v8.8h-1.8zM3.4 3.6v8.8L10 8z" />;
  if (name === "stop") return <path d="M4 4h8v8H4z" />;
  return <path d="M3 3.4v9.2L8.6 8zM9.6 3.6h1.4v8.8H9.6zM12 3.6h1.4v8.8H12z" />;
}

const KEYS = [
  ["open", "Open lid"],
  ["prev", "Previous track"],
  ["play", "Play or pause"],
  ["next", "Next track"],
  ["stop", "Stop"],
];

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createDisc } = await import("./discEngine");
      if (cancelled) return;
      engine = createDisc(root, { embedded, onReady: () => setReady(true), onFail: () => setFailed(true) });
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
    <Root ref={rootRef} className="disc" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined} data-lid="under">
      <div className="disc-stage" data-disc="stage">
        <div className="disc-player" data-disc="player">
          <div className="disc-body">
            <div className="disc-well">
              <div className="disc-sled">
                <div className="disc-lens" />
              </div>
              <div className="disc-spindle" />
            </div>
            <div className="disc-strip" data-disc-noplay="">
              <div className="disc-lcd" aria-hidden="true">
                <span className="disc-lcd-icons">
                  <svg viewBox="0 0 8 8" data-disc="play-icon">
                    <path d="M1 0.6v6.8L7 4z" />
                  </svg>
                  <svg viewBox="0 0 8 8" data-disc="pause-icon">
                    <path d="M1 0.8h2.2v6.4H1zM4.8 0.8H7v6.4H4.8z" />
                  </svg>
                </span>
                <Digit />
                <Digit />
                <span className="disc-lcd-gap" />
                <Digit />
                <Digit />
                <svg className="disc-colon" viewBox="0 0 4 20" data-disc="colon">
                  <rect x="1" y="5" width="2" height="2" />
                  <rect x="0.6" y="13" width="2" height="2" />
                </svg>
                <Digit />
                <Digit />
              </div>
              <div className="disc-keys">
                {KEYS.map(([name, label]) => (
                  <button key={name} type="button" className="disc-key" data-disc={`key-${name}`} data-key={name} aria-label={label}>
                    <svg viewBox="0 0 16 16" aria-hidden="true">
                      <KeyIcon name={name} />
                    </svg>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
        <canvas className="disc-canvas" data-disc="canvas" aria-hidden="true" />
        <div className="disc-lid" data-disc="lid" role="button" tabIndex={0} aria-label="Open or close the lid">
          <div className="disc-lid-face disc-lid-top">
            <div className="disc-lid-latch" />
          </div>
          <div className="disc-lid-face disc-lid-window" />
          <div className="disc-lid-face disc-lid-under">
            <div className="disc-lid-pad" />
          </div>
        </div>
        <button type="button" className="disc-flip" data-disc="flip" aria-pressed="false">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
            <path d="M3 6.2a5.2 5.2 0 0 1 9.4-1.6M13 9.8a5.2 5.2 0 0 1-9.4 1.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M12.8 2.4v2.6h-2.6M3.2 13.6V11h2.6" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Turn over</span>
        </button>
        <p className="disc-track" data-disc="track" aria-live="polite" />
        {embedded ? null : (
          <header className="disc-caption" data-disc="caption">
            <div className="disc-caption-text">
              <h1 className="disc-title">Disc</h1>
              <p className="disc-hint">Spin it by the edge. Hold the middle to carry it to the player, label side up.</p>
            </div>
            <button type="button" className="disc-sound" aria-pressed={sound} onClick={toggleSound}>
              <SpeakerIcon on={sound} />
              <span>{sound ? "Sound on" : "Sound off"}</span>
            </button>
          </header>
        )}
      </div>
      {failed ? <p className="disc-fallback">This disc needs WebGL 2.</p> : null}
    </Root>
  );
}
