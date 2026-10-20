"use client";

import { useEffect, useRef, useState } from "react";

import { useTopSongs } from "@/app/lab/_music/useTopSongs";

import "./vfd.css";

function SpeakerIcon({ on }) {
  return (
    <svg className="vfd-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
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
  const tracksRef = useRef([]);
  const { tracks } = useTopSongs(16);
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(false);
  const [live, setLive] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    tracksRef.current = tracks;
    engineRef.current?.setTracks(tracks);
  }, [tracks]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createVfd } = await import("./vfdEngine");
      if (cancelled) return;
      engine = createVfd(stage, { tracks: tracksRef.current, embedded, caption: captionRef.current, onLive: setLive, onFail: () => setFailed(true) });
      engineRef.current = engine;
      setReady(true);
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
    <Root className="vfd" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      <div ref={stageRef} className="vfd-stage">
        {embedded ? null : (
          <header ref={captionRef} className="vfd-caption">
            <div className="vfd-caption-text">
              <h1 className="vfd-title">VFD</h1>
              <p className="vfd-hint">Scroll or drag to skip a track, hold to fast-forward, tap to pause.</p>
            </div>
            <button type="button" className="vfd-sound" aria-pressed={sound} onClick={toggleSound}>
              <SpeakerIcon on={sound} />
              <span>{sound ? "Sound on" : "Sound off"}</span>
            </button>
          </header>
        )}
      </div>
      {failed ? <p className="vfd-fallback">This display needs WebGL 2.</p> : null}
      <p className="vfd-live" aria-live="polite">
        {live}
      </p>
    </Root>
  );
}
