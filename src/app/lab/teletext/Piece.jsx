"use client";

import { useEffect, useRef, useState } from "react";

import "./teletext.css";

function SpeakerIcon({ on }) {
  return (
    <svg className="teletext-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
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
  const [sound, setSound] = useState(false);
  const [live, setLive] = useState("");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createTeletext } = await import("./teletextEngine");
      if (cancelled) return;
      engine = createTeletext(stage, { embedded, caption: captionRef.current, onLive: setLive, onFail: () => setFailed(true) });
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
    <Root className="teletext" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      <div ref={stageRef} className="teletext-stage">
        {embedded ? null : (
          <header ref={captionRef} className="teletext-caption">
            <div className="teletext-caption-text">
              <h1 className="teletext-title">Teletext</h1>
              <p className="teletext-hint">
                <span className="teletext-hint-fine">Type a page number to hold it, or click a record or a coloured link.</span>
                <span className="teletext-hint-touch">Tap a record or a coloured link to hold it, or tap the top line to type a page.</span>
              </p>
            </div>
            <button type="button" className="teletext-sound" aria-pressed={sound} onClick={toggleSound}>
              <SpeakerIcon on={sound} />
              <span>{sound ? "Sound on" : "Sound off"}</span>
            </button>
          </header>
        )}
      </div>
      {failed ? <p className="teletext-fallback">This screen needs WebGL 2.</p> : null}
      <p className="teletext-live" aria-live="polite">
        {live}
      </p>
    </Root>
  );
}
