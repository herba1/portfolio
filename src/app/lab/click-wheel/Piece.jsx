"use client";

import { useEffect, useRef, useState } from "react";

import { useTopSongs } from "@/app/lab/_music/useTopSongs";

import "./click-wheel.css";

function SpeakerIcon({ on }) {
  return (
    <svg className="click-wheel-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
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
  const captionRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(true);
  const [live, setLive] = useState("");
  const { tracks } = useTopSongs(25);
  const tracksRef = useRef(tracks);

  useEffect(() => {
    tracksRef.current = tracks;
    engineRef.current?.setTopSongs(tracks);
  }, [tracks]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createClickWheel } = await import("./wheelEngine");
      if (cancelled) return;
      engine = createClickWheel(stage, { embedded, caption: captionRef.current, onLive: setLive, onReady: () => setReady(true) });
      engine.setTopSongs(tracksRef.current);
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
    if (result !== next) setSound(false);
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root className="click-wheel" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      <div ref={stageRef} className="click-wheel-stage">
        {embedded ? null : (
          <header ref={captionRef} className="click-wheel-caption">
            <div className="click-wheel-caption-text">
              <h1 className="click-wheel-heading">Click Wheel</h1>
              <p className="click-wheel-hint">Circle the wheel to scroll, press the centre to choose, Menu to go back. Try Music, Albums, Abbey Road.</p>
            </div>
            <button type="button" className="click-wheel-sound" aria-pressed={sound} onClick={toggleSound}>
              <SpeakerIcon on={sound} />
              <span>{sound ? "Sound on" : "Sound off"}</span>
            </button>
          </header>
        )}
      </div>
      <p className="click-wheel-live" aria-live="polite">
        {live}
      </p>
    </Root>
  );
}
