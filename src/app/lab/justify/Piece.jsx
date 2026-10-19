"use client";

import { useEffect, useRef, useState } from "react";

import { PRESETS } from "./justifyEngine";
import "./justify.css";

function SpeakerIcon({ on }) {
  return (
    <svg className="justify-speaker" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
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
  const stageRef = useRef(null);
  const areaRef = useRef(null);
  const handleRef = useRef(null);
  const inputRef = useRef(null);
  const captionRef = useRef(null);
  const controlsRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [sound, setSound] = useState(true);
  const [preset, setPreset] = useState(PRESETS[0].id);
  const [soft, setSoft] = useState(Math.round(PRESETS[0].soft * 100));

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createJustify } = await import("./justifyEngine");
      if (cancelled) return;
      engine = createJustify(
        root,
        { stage: stageRef.current, area: areaRef.current, handle: handleRef.current, input: inputRef.current, caption: captionRef.current, controls: controlsRef.current },
        { onEdit: () => setPreset(null), onReady: () => setReady(true) },
      );
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

  const choose = (item) => {
    const engine = engineRef.current;
    if (!engine) return;
    engine.unlock();
    setPreset(item.id);
    setSoft(Math.round(engine.setPreset(item) * 100));
  };

  const onSoft = (e) => {
    const value = Number(e.target.value);
    setSoft(value);
    engineRef.current?.unlock();
    engineRef.current?.setSoftness(value / 100);
  };

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
    <Root ref={rootRef} className="justify" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      <div ref={stageRef} className="justify-stage">
        <div ref={areaRef} className="justify-area" aria-hidden="true" />
        <textarea
          ref={inputRef}
          className="justify-input"
          aria-label="Lyric"
          rows={1}
          spellCheck={false}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          enterKeyHint="done"
          maxLength={120}
        />
        <button ref={handleRef} type="button" className="justify-handle" aria-label="Column width. Arrow keys to change.">
          <span className="justify-knob" />
        </button>
      </div>
      {embedded ? null : (
        <header ref={captionRef} className="justify-caption">
          <h1 className="justify-title">Justify</h1>
          <p className="justify-hint">Drag the right edge to re-set the measure, or click the words to rewrite them.</p>
        </header>
      )}
      <div ref={controlsRef} className="justify-controls">
        {embedded ? null : (
          <div className="justify-presets" role="group" aria-label="Lyrics">
            {PRESETS.map((item) => (
              <button key={item.id} type="button" className="justify-chip" aria-pressed={preset === item.id} onClick={() => choose(item)}>
                {item.label}
              </button>
            ))}
          </div>
        )}
        <div className="justify-tools">
          <label className="justify-soft">
            <span className="justify-soft-label">Softness</span>
            <input className="justify-range" type="range" min="0" max="100" step="1" value={soft} onChange={onSoft} style={{ "--justify-fill": `${soft}%` }} />
          </label>
          {embedded ? null : (
            <button type="button" className="justify-sound" aria-pressed={sound} onClick={toggleSound} aria-label={sound ? "Sound on" : "Sound off"}>
              <SpeakerIcon on={sound} />
            </button>
          )}
        </div>
      </div>
    </Root>
  );
}
