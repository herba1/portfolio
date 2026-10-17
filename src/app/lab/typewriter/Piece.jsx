"use client";

import { useEffect, useRef, useState } from "react";

import { STRIP_ROWS } from "./typewriterNotes";
import "./typewriter.css";

const STAGE_LABEL =
  "A 1960s typewriter seen from above the platen, with liner notes already typed on the sheet. Type on your keyboard to strike the paper; Return throws the carriage back and advances the line, Backspace steps back so you can overtype, and the arrow keys roll the platen. Drag the sheet sideways to move the carriage or up and down to roll the platen.";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const glRef = useRef(null);
  const overlayRef = useRef(null);
  const keysRef = useRef(null);
  const headRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [shift, setShift] = useState(false);
  const [sound, setSound] = useState(true);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let engine = null;
    const insets = () => {
      const box = root.getBoundingClientRect();
      const keys = keysRef.current?.getBoundingClientRect();
      const head = headRef.current?.getBoundingClientRect();
      const bottom = keys && keys.height ? box.bottom - keys.top + 12 : 12;
      let top = embedded ? 12 : 72;
      if (head && box.width < 900) top = head.bottom - box.top + 8;
      return { top, bottom };
    };
    const start = async () => {
      try {
        const { default: TypewriterEngine } = await import("./typewriterEngine");
        if (cancelled) return;
        engine = new TypewriterEngine({
          stage: stageRef.current,
          glCanvas: glRef.current,
          overlay: overlayRef.current,
          keys: keysRef.current,
          embedded,
          insets,
          onReady: () => {
            if (!cancelled) setReady(true);
          },
          onFail: () => {
            if (!cancelled) setFailed(true);
          },
          onShift: (on) => {
            if (!cancelled) setShift(on);
          },
        });
        engineRef.current = engine;
        await engine.start();
      } catch (error) {
        console.error(error);
        if (!cancelled) setFailed(true);
      }
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

  const onKey = (e) => {
    e.preventDefault();
    engineRef.current?.pressKey(e.currentTarget.getAttribute("data-key"));
  };

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    engineRef.current?.setSound(next);
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root
      ref={rootRef}
      className="typewriter-root"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
      data-failed={failed ? "" : undefined}
    >
      <div ref={stageRef} className="typewriter-stage" tabIndex={0} role="application" aria-label={STAGE_LABEL}>
        <canvas ref={glRef} className="typewriter-canvas" />
        <canvas ref={overlayRef} className="typewriter-canvas typewriter-overlay" />
      </div>

      {embedded ? null : (
        <header ref={headRef} className="typewriter-head">
          <h1 className="typewriter-title">Typewriter</h1>
          <p className="typewriter-lede">
            Type on your keyboard. Return <em>throws the carriage</em>; drag the sheet to slide it or roll the platen.
          </p>
          <button type="button" className="typewriter-sound" aria-pressed={sound} onClick={toggleSound}>
            <span className="typewriter-sound-mark" aria-hidden="true" />
            {sound ? "Sound on" : "Sound off"}
          </button>
        </header>
      )}

      {embedded ? null : (
        <div ref={keysRef} className="typewriter-keys" aria-hidden="true">
          {STRIP_ROWS.map((row, r) => (
            <div key={row} className="typewriter-row" data-row={r}>
              {row.split("").map((ch) => (
                <button key={ch} type="button" tabIndex={-1} data-key={ch} className="typewriter-key" onPointerDown={onKey}>
                  <span className="typewriter-legend">{shift ? ch.toUpperCase() : ch}</span>
                </button>
              ))}
            </div>
          ))}
          <div className="typewriter-row typewriter-row-base">
            <button type="button" tabIndex={-1} data-key="shift" data-on={shift ? "" : undefined} className="typewriter-key typewriter-key-wide" onPointerDown={onKey}>
              shift
            </button>
            <button type="button" tabIndex={-1} data-key=" " className="typewriter-space" onPointerDown={onKey}>
              <span className="typewriter-sr">space</span>
            </button>
            <button type="button" tabIndex={-1} data-key="back" className="typewriter-key typewriter-key-wide" onPointerDown={onKey}>
              back
            </button>
            <button type="button" tabIndex={-1} data-key="return" className="typewriter-key typewriter-key-wide typewriter-key-return" onPointerDown={onKey}>
              return
            </button>
          </div>
        </div>
      )}

      {failed ? <p className="typewriter-fallback">This piece needs WebGL 2.</p> : null}
    </Root>
  );
}
