"use client";

import { useEffect, useRef, useState } from "react";

import { PRESSINGS } from "./groovePressings";
import "./groove.css";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const headRef = useRef(null);
  const controlsRef = useRef(null);
  const speedRef = useRef(null);
  const engineRef = useRef(null);
  const pressingRef = useRef(0);
  const strobeRef = useRef(true);
  const [pressing, setPressing] = useState(0);
  const [strobe, setStrobe] = useState(true);
  const [thumbs, setThumbs] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      try {
        const [{ createGroove }] = await Promise.all([
          import("./grooveEngine"),
          document.fonts?.ready,
        ]);
        if (cancelled) return;
        engine = createGroove({
          box: root,
          canvas,
          header: embedded ? null : headRef.current,
          controls: embedded ? null : controlsRef.current,
          speedEl: speedRef.current,
          embedded,
          index: pressingRef.current,
          strobe: strobeRef.current,
          onThumbs: (urls) => {
            if (!cancelled) setThumbs(urls);
          },
        });
        engineRef.current = engine;
        root.setAttribute("data-ready", "");
      } catch (error) {
        console.error(error);
        if (!cancelled) setFailed(true);
      }
    };
    start();
    return () => {
      cancelled = true;
      engine?.destroy();
      engineRef.current = null;
    };
  }, [embedded]);

  const choose = (i) => {
    pressingRef.current = i;
    setPressing(i);
    engineRef.current?.setPressing(i);
  };

  const toggleStrobe = () => {
    const next = !strobeRef.current;
    strobeRef.current = next;
    setStrobe(next);
    engineRef.current?.setStrobe(next);
  };

  const Root = embedded ? "div" : "main";
  const current = PRESSINGS[pressing];

  return (
    <Root
      ref={rootRef}
      className="groove-root"
      data-embedded={embedded ? "" : undefined}
    >
      <canvas
        ref={canvasRef}
        className="groove-canvas"
        tabIndex={0}
        role="application"
        aria-label={`${current.name} record spinning at 33⅓ under a strobe lamp. Drag the record to spin it by hand; let go and the motor brings it back to speed. Left and right arrows push it, Space stops and starts the motor.`}
      />
      {embedded ? null : (
        <header ref={headRef} className="groove-head">
          <h1 className="groove-title">Groove</h1>
          <p className="groove-lede">
            Real kinds of pressing. Under the strobe at 33⅓ the zoetrope&rsquo;s
            drawings <em>come alive</em>; spin it by hand and they stall and run
            backwards.
          </p>
        </header>
      )}
      {embedded ? (
        <span ref={speedRef} hidden />
      ) : (
        <div ref={controlsRef} className="groove-controls">
          <div className="groove-pick" role="radiogroup" aria-label="Pressing">
            {PRESSINGS.map((p, i) => (
              <button
                key={p.key}
                type="button"
                role="radio"
                aria-checked={pressing === i}
                aria-label={p.name}
                className="groove-chip"
                onClick={() => choose(i)}
              >
                <span
                  className="groove-thumb"
                  style={
                    thumbs
                      ? { backgroundImage: `url(${thumbs[i]})` }
                      : undefined
                  }
                  aria-hidden="true"
                />
                <span className="groove-chip-name">{p.name}</span>
              </button>
            ))}
          </div>
          <div className="groove-row">
            <button
              type="button"
              className="groove-strobe"
              aria-pressed={strobe}
              onClick={toggleStrobe}
            >
              <span className="groove-lamp" aria-hidden="true" />
              Strobe
            </button>
            <p className="groove-rpm">
              <span ref={speedRef} className="groove-rpm-value">
                33⅓
              </span>{" "}
              rpm
            </p>
          </div>
        </div>
      )}
      {failed ? (
        <p className="groove-fallback">This record needs a canvas.</p>
      ) : null}
    </Root>
  );
}
