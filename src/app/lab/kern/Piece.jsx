"use client";

import { useEffect, useRef, useState } from "react";

import "./kern.css";

function SpeakerIcon({ on }) {
  return (
    <svg className="kern-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
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
  const readoutRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(false);
  const [heavy, setHeavy] = useState(false);
  const [morphing, setMorphing] = useState(false);
  const [live, setLive] = useState("");

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createKern } = await import("./kernEngine");
      if (cancelled) return;
      engine = createKern(stage, { embedded, readout: readoutRef.current, onLive: setLive, onMorph: setMorphing });
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

  const toggleHeavy = () => {
    const next = !heavy;
    setHeavy(next);
    engineRef.current?.setHeavy(next);
  };

  const editWord = () => engineRef.current?.editWord();

  const Root = embedded ? "div" : "main";

  return (
    <Root className="kern" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      <div ref={stageRef} className="kern-stage" />
      {embedded ? null : (
        <header className="kern-caption">
          <div className="kern-caption-text">
            <h1 className="kern-title">Kern</h1>
            <p className="kern-hint">Pull a letter and let go. Hold Shift, or tap Light, for the heavy cut. Type to set a new word.</p>
          </div>
          <div className="kern-actions">
            <button type="button" className="kern-pill kern-type" onClick={editWord}>
              Type a word
            </button>
            <button type="button" className="kern-pill" aria-pressed={heavy} data-morphing={morphing ? "" : undefined} onClick={toggleHeavy}>
              <span className="kern-aa" aria-hidden="true">
                Aa
              </span>
              <span>{heavy ? "Heavy" : "Light"}</span>
            </button>
            <button type="button" className="kern-pill" aria-pressed={sound} onClick={toggleSound}>
              <SpeakerIcon on={sound} />
              <span>{sound ? "Sound on" : "Sound off"}</span>
            </button>
          </div>
        </header>
      )}
      <p className="kern-readout">
        <span className="kern-family">Bricolage Grotesque</span>
        <span ref={readoutRef} className="kern-values" />
      </p>
      <p className="kern-live" aria-live="polite">
        {live}
      </p>
    </Root>
  );
}
