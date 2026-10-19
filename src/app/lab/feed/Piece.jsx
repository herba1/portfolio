"use client";

import { useEffect, useRef, useState } from "react";

import sky from "./sky.jpg";
import times from "./times.jpg";
import "./feed.css";

function SpeakerIcon({ on }) {
  return (
    <svg className="feed-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
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
  const screenRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    const screen = screenRef.current;
    if (!root || !screen) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createFeed } = await import("./feedEngine");
      if (cancelled) return;
      engine = createFeed(root, {
        screen,
        photos: { times: times.src, sky: sky.src },
        onReady: () => setReady(true),
        onSound: (on) => setSound(on),
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
    <Root ref={rootRef} className="feed" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      {embedded ? null : (
        <header className="feed-caption">
          <div className="feed-caption-text">
            <h1 className="feed-title">For You</h1>
            <p className="feed-hint">Five lyric edits in a phone feed. Swipe, scroll or use the arrow keys; double-tap to like, tap to pause.</p>
          </div>
          <button type="button" className="feed-sound" aria-pressed={sound} onClick={toggleSound}>
            <SpeakerIcon on={sound} />
            <span>{sound ? "Sound on" : "Sound off"}</span>
          </button>
        </header>
      )}
      <div className="feed-phone">
        <div ref={screenRef} className="feed-screen" tabIndex={0} aria-label="Lyric edit feed" />
      </div>
    </Root>
  );
}
