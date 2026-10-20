"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import useNearViewport from "@/app/experiments/useNearViewport";

import LinocutEngine from "./linocutEngine";
import "./linocut.css";

const KEY_STEP = 0.04;

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const handleRef = useRef(null);
  const altitudeRef = useRef(null);
  const engineRef = useRef(null);
  const pointerRef = useRef(null);
  const near = useNearViewport(rootRef);
  const [phase, setPhase] = useState("loading");
  const [gouge, setGouge] = useState(0.85);
  const [swirl, setSwirl] = useState(0.85);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!near) return undefined;
    const engine = new LinocutEngine({
      root: rootRef.current,
      stage: stageRef.current,
      canvas: canvasRef.current,
      onReady: () => setPhase("ready"),
      onError: () => setPhase("error"),
      onMoon: (moon) => {
        const handle = handleRef.current;
        if (!moon || !handle) return;
        handle.style.transform = `translate3d(${moon.x}px, ${moon.y}px, 0)`;
        handle.style.setProperty("--lino-moon", `${Math.round(Math.max(24, moon.r * 2 + 20))}px`);
        if (altitudeRef.current) altitudeRef.current.textContent = `${Math.max(0, moon.altitude)}°`;
      },
    });
    engineRef.current = engine;
    engine.start();
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, [near]);

  const onDown = useCallback((event) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    if (pointerRef.current != null) return;
    pointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    setDragging(true);
    engineRef.current?.aimMoon(event.clientX, event.clientY);
  }, []);

  const onMove = useCallback((event) => {
    if (pointerRef.current !== event.pointerId) return;
    engineRef.current?.aimMoon(event.clientX, event.clientY);
  }, []);

  const onUp = useCallback((event) => {
    if (pointerRef.current !== event.pointerId) return;
    pointerRef.current = null;
    setDragging(false);
  }, []);

  const onKey = useCallback((event) => {
    const moves = { ArrowLeft: [-KEY_STEP, 0], ArrowRight: [KEY_STEP, 0], ArrowUp: [0, KEY_STEP], ArrowDown: [0, -KEY_STEP] };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    engineRef.current?.nudgeMoon(move[0], move[1]);
  }, []);

  const changeGouge = (value) => {
    setGouge(value);
    engineRef.current?.setGouge(value);
  };

  const changeSwirl = (value) => {
    setSwirl(value);
    engineRef.current?.setSwirl(value);
  };

  return (
    <div
      ref={rootRef}
      className="linocut"
      data-phase={phase}
      data-ready={phase === "ready" ? "" : undefined}
      data-embedded={embedded ? "" : undefined}
      data-dragging={dragging ? "" : undefined}
    >
      <div ref={stageRef} className="linocut__stage" aria-hidden="true" />
      <canvas
        ref={canvasRef}
        className="linocut__canvas"
        role="application"
        aria-roledescription="lino print"
        aria-label="A moonlit sea with a small sailing boat, carved as a black lino print on cream paper. The cut lines spiral out from the moon. Drag anywhere on the print, or use the arrow keys, to move the moon and the whole print re-carves around it."
        tabIndex={0}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={onKey}
      />
      <span ref={handleRef} className="linocut__moon" aria-hidden="true" />

      <p className="linocut__caption">
        <span>Night swell, relief print on cream paper</span>
        <span className="linocut__altitude">
          Moon <span ref={altitudeRef}>0°</span>
        </span>
      </p>

      {embedded ? null : (
        <header className="linocut__head">
          <h1 className="linocut__title">Linocut</h1>
          <p className="linocut__lede">
            A moonlit sea carved as a lino block. Drag the moon and every cut line <em>re-spirals</em> around it while the boat rides the swell.
          </p>
        </header>
      )}

      <div className="linocut__bar">
        <label className="linocut__control">
          <span className="linocut__label">Gouge</span>
          <input
            type="range"
            min="0.55"
            max="1.15"
            step="0.01"
            value={gouge}
            onChange={(event) => changeGouge(Number(event.target.value))}
            className="linocut__range"
            style={{ "--lino-fill": `${((gouge - 0.55) / 0.6) * 100}%` }}
            aria-valuetext={gouge < 0.75 ? "Wide cuts" : gouge > 0.95 ? "Fine cuts" : "Medium cuts"}
          />
        </label>
        <label className="linocut__control">
          <span className="linocut__label">Swirl</span>
          <input
            type="range"
            min="0"
            max="2"
            step="0.01"
            value={swirl}
            onChange={(event) => changeSwirl(Number(event.target.value))}
            className="linocut__range"
            style={{ "--lino-fill": `${(swirl / 2) * 100}%` }}
          />
        </label>
      </div>

      {phase === "error" ? <p className="linocut__error">This piece needs WebGL to carve.</p> : null}
    </div>
  );
}
