"use client";

import { useEffect, useRef, useState } from "react";

import useNearViewport from "@/app/experiments/useNearViewport";

import { DEFAULT_LINE, MAX_TWIST } from "./ribbonEngine";
import "./ribbon.css";

const TWISTS = Array.from({ length: MAX_TWIST + 1 }, (_, i) => i);
const TWIST_NAMES = ["A plain ring", "A Möbius band, one side", "Two half twists", "Three half twists, one side"];

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const headRef = useRef(null);
  const barRef = useRef(null);
  const engineRef = useRef(null);
  const near = useNearViewport(rootRef);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [twist, setTwist] = useState(1);
  const [line, setLine] = useState(DEFAULT_LINE);

  useEffect(() => {
    if (!near) return undefined;
    let cancelled = false;
    let engine = null;
    const stage = stageRef.current;
    const insets = () => {
      const box = stage.getBoundingClientRect();
      const head = headRef.current?.getBoundingClientRect();
      const bar = barRef.current?.getBoundingClientRect();
      const top = head ? head.bottom - box.top + 24 : 32;
      const bottom = bar ? box.bottom - bar.top + 24 : 32;
      return { top, bottom };
    };
    import("./ribbonEngine").then(({ createRibbon }) => {
      if (cancelled) return;
      engine = createRibbon(stage, {
        canvas: canvasRef.current,
        insets,
        onTwist: setTwist,
        onReady: () => setReady(true),
        onFail: () => setFailed(true),
      });
      engineRef.current = engine;
    });
    return () => {
      cancelled = true;
      engine?.destroy();
      engineRef.current = null;
    };
  }, [near]);

  const onLine = (e) => {
    setLine(e.target.value);
    engineRef.current?.setText(e.target.value);
  };

  const justFocused = useRef(false);
  const onLineFocus = (e) => {
    justFocused.current = true;
    e.target.select();
  };
  const onLineMouseUp = (e) => {
    if (!justFocused.current) return;
    justFocused.current = false;
    e.preventDefault();
  };

  const onStageKey = (e) => {
    const engine = engineRef.current;
    if (!engine) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      e.preventDefault();
      engine.nudge(e.key === "ArrowLeft" ? 1 : -1);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      engine.twistBy(e.key === "ArrowUp" ? 1 : -1);
    }
  };

  const pickTwist = (n) => {
    setTwist(n);
    engineRef.current?.setTwist(n);
  };

  return (
    <div ref={rootRef} className="ribbon" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      <div
        ref={stageRef}
        className="ribbon__stage"
        tabIndex={0}
        role="img"
        aria-label={`${line.trim() || DEFAULT_LINE}, set on a turning ring of type. ${TWIST_NAMES[twist]}. Drag sideways to spin it, up or down to twist it; arrow keys do the same.`}
        onKeyDown={onStageKey}
      >
        <canvas ref={canvasRef} className="ribbon__canvas" />
      </div>

      {embedded ? null : (
        <header ref={headRef} className="ribbon__head">
          <h1 className="ribbon__title">Ribbon</h1>
          <p className="ribbon__hint">Drag sideways to spin it, up or down to twist it.</p>
        </header>
      )}

      <div ref={barRef} className="ribbon__bar">
        {embedded ? null : (
          <label className="ribbon__line">
            <span className="ribbon__sr">Your line</span>
            <input
              className="ribbon__input"
              value={line}
              onChange={onLine}
              onFocus={onLineFocus}
              onMouseUp={onLineMouseUp}
              onBlur={() => {
                justFocused.current = false;
              }}
              maxLength={48}
              spellCheck={false}
              autoComplete="off"
              placeholder={DEFAULT_LINE}
            />
          </label>
        )}
        <div className="ribbon__twists" role="radiogroup" aria-label="Half twists">
          <span className="ribbon__twists-label" aria-hidden="true">
            Half twists
          </span>
          {TWISTS.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={twist === n}
              aria-label={TWIST_NAMES[n]}
              className="ribbon__twist"
              onClick={() => pickTwist(n)}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {failed ? <p className="ribbon__fallback">This ribbon needs WebGL 2.</p> : null}
    </div>
  );
}
