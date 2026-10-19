"use client";

import { useEffect, useRef, useState } from "react";

import "./channel.css";

function SpeakerIcon({ on }) {
  return (
    <svg className="channel-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M2.5 6h2.2L8 3.2v9.6L4.7 10H2.5z" fill="currentColor" />
      {on ? (
        <path d="M10.4 5.6a3.4 3.4 0 0 1 0 4.8M12.2 4a5.6 5.6 0 0 1 0 8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      ) : (
        <path d="M10.6 6.1l3.8 3.8M14.4 6.1l-3.8 3.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      )}
    </svg>
  );
}

function DegaussIcon() {
  return (
    <svg className="channel-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <path d="M8 2.5a5.5 5.5 0 1 0 5.5 5.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      <path d="M8 5a3 3 0 1 0 3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" fill="none" />
      <circle cx="8" cy="8" r="0.9" fill="currentColor" />
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
      const { createChannel } = await import("./channelEngine");
      if (cancelled) return;
      engine = createChannel(stage, { embedded, caption: captionRef.current, onLive: setLive, onFail: () => setFailed(true) });
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
    <Root className="channel" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      <div ref={stageRef} className="channel-stage">
        {embedded ? null : <div className="channel-shade" aria-hidden="true" />}
        {embedded ? null : (
          <header ref={captionRef} className="channel-caption">
            <div className="channel-caption-text">
              <h1 className="channel-title">Channel</h1>
              <p className="channel-hint">Drag, scroll or tap the picture to change channel. Arrow keys work too.</p>
            </div>
            <div className="channel-buttons">
              <button type="button" className="channel-sound" onClick={() => engineRef.current?.degauss()}>
                <DegaussIcon />
                <span>Degauss</span>
              </button>
              <button type="button" className="channel-sound" aria-pressed={sound} onClick={toggleSound}>
                <SpeakerIcon on={sound} />
                <span>{sound ? "Sound on" : "Sound off"}</span>
              </button>
            </div>
          </header>
        )}
      </div>
      {failed ? <p className="channel-fallback">This screen needs WebGL 2.</p> : null}
      <p className="channel-live" aria-live="polite">
        {live}
      </p>
    </Root>
  );
}
