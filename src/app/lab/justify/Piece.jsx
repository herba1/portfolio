"use client";

import { Fragment, useEffect, useRef, useState } from "react";

import { PRESETS } from "./justifyEngine";
import "./justify.css";

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

  const scrubRef = useRef(null);

  const applySoft = (value) => {
    const next = Math.max(0, Math.min(100, Math.round(value)));
    setSoft(next);
    engineRef.current?.unlock();
    engineRef.current?.setSoftness(next / 100);
  };

  const onScrubDown = (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    scrubRef.current = { id: e.pointerId, x: e.clientX, from: soft };
  };

  const onScrubMove = (e) => {
    const scrub = scrubRef.current;
    if (!scrub || scrub.id !== e.pointerId) return;
    applySoft(scrub.from + (e.clientX - scrub.x) * 0.5);
  };

  const onScrubUp = (e) => {
    const scrub = scrubRef.current;
    if (!scrub || scrub.id !== e.pointerId) return;
    if (Math.abs(e.clientX - scrub.x) < 3 && e.type === "pointerup") applySoft(soft >= 50 ? 0 : 100);
    scrubRef.current = null;
  };

  const onScrubKey = (e) => {
    const steps = { ArrowRight: 5, ArrowUp: 5, ArrowLeft: -5, ArrowDown: -5, PageUp: 20, PageDown: -20 };
    if (e.key in steps) {
      e.preventDefault();
      applySoft(soft + steps[e.key]);
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      applySoft(e.key === "Home" ? 0 : 100);
    }
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
          <p className="justify-hint">Drag the right edge to re-set the measure, click the words to rewrite them, drag soft to blur.</p>
        </header>
      )}
      <div ref={controlsRef} className="justify-controls">
        {embedded ? null : (
          <div className="justify-presets" role="group" aria-label="Lyrics">
            {PRESETS.map((item) => (
              <Fragment key={item.id}>
                <button type="button" className="justify-word" aria-pressed={preset === item.id} onClick={() => choose(item)}>
                  {item.label}
                </button>{" "}
              </Fragment>
            ))}
          </div>
        )}{" "}
        <div className="justify-tools">
          <span
            role="slider"
            tabIndex={0}
            className="justify-word justify-soft"
            aria-label="Softness"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={soft}
            onPointerDown={onScrubDown}
            onPointerMove={onScrubMove}
            onPointerUp={onScrubUp}
            onPointerCancel={onScrubUp}
            onKeyDown={onScrubKey}
            style={{ "--justify-soft": soft / 100 }}
          >
            soft
          </span>{" "}
          {embedded ? null : (
            <button type="button" className="justify-word justify-sound" aria-pressed={sound} onClick={toggleSound}>
              {sound ? "sound" : "quiet"}
            </button>
          )}
        </div>
      </div>
    </Root>
  );
}
