"use client";

import { useEffect, useRef, useState } from "react";

import { SLEEVES } from "./iceSleeves";
import "./ice.css";

const STAGE_LABEL =
  "A record sleeve frozen inside a clear block of ice on a slate table. Hold the pointer on the ice, or rest the cursor on it, to melt a hollow; melt down to the record and it slides free. Arrow keys move the warm spot, hold Enter to melt, R refreezes a new block, and 1 to 3 change the record.";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const cursorRef = useRef(null);
  const headRef = useRef(null);
  const barRef = useRef(null);
  const engineRef = useRef(null);
  const [active, setActive] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [phase, setPhase] = useState("held");

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let engine = null;
    const insets = () => {
      if (embedded) return { top: 24, bottom: 72 };
      const boxRect = root.getBoundingClientRect();
      const head = headRef.current?.getBoundingClientRect();
      const bar = barRef.current?.getBoundingClientRect();
      const top = head ? head.bottom - boxRect.top + 12 : 140;
      const bottom = bar ? boxRect.bottom - bar.top + 12 : 96;
      return { top, bottom };
    };
    const start = async () => {
      try {
        const { createIceEngine } = await import("./iceEngine");
        if (cancelled) return;
        engine = createIceEngine({
          box: root,
          stage: stageRef.current,
          canvas: canvasRef.current,
          cursor: cursorRef.current,
          insets,
          embedded,
          onReady: () => {
            if (!cancelled) setReady(true);
          },
          onFail: () => {
            if (!cancelled) setFailed(true);
          },
          onSelect: (idx) => {
            if (!cancelled) setActive(idx);
          },
          onState: (value) => {
            if (!cancelled) setPhase(value);
          },
        });
        engineRef.current = engine;
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

  const Root = embedded ? "div" : "main";

  return (
    <Root
      ref={rootRef}
      className="ice-root"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
      data-failed={failed ? "" : undefined}
      data-phase={phase}
    >
      <div ref={stageRef} className="ice-stage" tabIndex={0} role="application" aria-label={STAGE_LABEL}>
        <canvas ref={canvasRef} className="ice-canvas" />
        <span ref={cursorRef} className="ice-cursor" aria-hidden="true" />
      </div>

      {embedded ? null : (
        <header ref={headRef} className="ice-head">
          <h1 className="ice-title">On Ice</h1>
          <p className="ice-lede">
            Hold your cursor on the block. Melt down to the record and it <em>slides free</em>.
          </p>
        </header>
      )}

      <div ref={barRef} className="ice-bar">
        <div className="ice-sleeves" role="radiogroup" aria-label="Record">
          {SLEEVES.map((sleeve, i) => (
            <button
              key={sleeve.key}
              type="button"
              role="radio"
              aria-checked={active === i}
              aria-label={`${sleeve.artist}, ${sleeve.title}`}
              title={`${sleeve.artist}, ${sleeve.title}`}
              className="ice-sleeve"
              onClick={() => engineRef.current?.select(i)}
            >
              <span className="ice-thumb" style={{ backgroundImage: `url(${sleeve.src})` }} aria-hidden="true" />
              <span className="ice-sleeve-name">{sleeve.short}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          className="ice-refreeze"
          aria-label="Refreeze a new block"
          disabled={!ready || phase === "freezing"}
          onClick={() => engineRef.current?.refreeze()}
        >
          <svg className="ice-refreeze-icon" viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 2.5v15M3.5 6.25l13 7.5M3.5 13.75l13-7.5M8 3.75l2 1.5 2-1.5M8 16.25l2-1.5 2 1.5M3.3 9l2.3.9-.3 2.4M16.7 11l-2.3-.9.3-2.4M3.3 11l2.3-.9-.3-2.4M16.7 9l-2.3.9.3 2.4" />
          </svg>
          <span className="ice-refreeze-label">Refreeze</span>
        </button>
      </div>

      {failed ? <p className="ice-fallback">This piece needs WebGL 2.</p> : null}
    </Root>
  );
}
