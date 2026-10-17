"use client";

import { useEffect, useRef, useState } from "react";

import { BAND, SLEEVES } from "./thermoSleeves";
import "./thermochromic.css";

const STAGE_LABEL =
  "A record sleeve printed in black heat-sensitive ink over a portrait. Move or rest your pointer, or your fingers, on the sleeve to warm it: the ink turns clear and shows the face underneath, then cools back to black. Press Enter to lay a hand on it, and 1 to 3 to change the sleeve.";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const headRef = useRef(null);
  const footRef = useRef(null);
  const engineRef = useRef(null);
  const [active, setActive] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let engine = null;
    const insets = () => {
      if (embedded) return { top: 20, bottom: 20 };
      const boxRect = root.getBoundingClientRect();
      if (boxRect.width >= 900) return { top: 96, bottom: 40 };
      const head = headRef.current?.getBoundingClientRect();
      const foot = footRef.current?.getBoundingClientRect();
      const top = head ? head.bottom - boxRect.top + 20 : 140;
      const bottom = foot ? boxRect.bottom - foot.top + 20 : 96;
      return { top, bottom };
    };
    const start = async () => {
      try {
        const { createThermoEngine } = await import("./thermoEngine");
        if (cancelled) return;
        engine = createThermoEngine({
          box: root,
          stage: stageRef.current,
          canvas: canvasRef.current,
          insets,
          embedded,
          onSelect: (idx) => {
            if (!cancelled) setActive(idx);
          },
          onReady: () => {
            if (!cancelled) setReady(true);
          },
          onFail: () => {
            if (!cancelled) setFailed(true);
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
      className="thermochromic-root"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
      data-failed={failed ? "" : undefined}
    >
      <div ref={stageRef} className="thermochromic-stage" tabIndex={0} role="application" aria-label={STAGE_LABEL}>
        <canvas ref={canvasRef} className="thermochromic-canvas" />
      </div>

      {embedded ? null : (
        <header ref={headRef} className="thermochromic-head">
          <h1 className="thermochromic-title">Thermochromic</h1>
          <p className="thermochromic-lede">
            A sleeve printed in heat-sensitive black. Rest your hand on it and the ink <em>goes clear</em>.
          </p>
        </header>
      )}

      {embedded ? null : (
        <div ref={footRef} className="thermochromic-panel">
          <div className="thermochromic-presets" role="radiogroup" aria-label="Sleeve">
            {SLEEVES.map((sleeve, i) => (
              <button
                key={sleeve.key}
                type="button"
                role="radio"
                aria-checked={active === i}
                aria-label={`${BAND}, ${sleeve.album}`}
                className="thermochromic-preset"
                onClick={() => engineRef.current?.select(i)}
              >
                <span className="thermochromic-chip" aria-hidden="true" />
                <span className="thermochromic-preset-long">{sleeve.album}</span>
                <span className="thermochromic-preset-short">{sleeve.short}</span>
              </button>
            ))}
          </div>
          <p className="thermochromic-note">Clears at 31 °C, back to black as it cools.</p>
        </div>
      )}

      {failed ? <p className="thermochromic-fallback">This piece needs WebGL 2.</p> : null}
    </Root>
  );
}
