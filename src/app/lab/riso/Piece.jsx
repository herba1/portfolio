"use client";

import { useEffect, useRef, useState } from "react";

import { POSTERS } from "./risoPosters";
import "./riso.css";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const tagRef = useRef(null);
  const statusRef = useRef(null);
  const headRef = useRef(null);
  const footRef = useRef(null);
  const engineRef = useRef(null);
  const [active, setActive] = useState(0);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [registered, setRegistered] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let engine = null;
    const insets = () => {
      if (embedded) return { top: 20, bottom: 20 };
      const boxRect = root.getBoundingClientRect();
      if (boxRect.width >= 900) return { top: 96, bottom: 32 };
      const head = headRef.current?.getBoundingClientRect();
      const foot = footRef.current?.getBoundingClientRect();
      const top = head ? head.bottom - boxRect.top + 20 : 140;
      const bottom = foot ? boxRect.bottom - foot.top + 16 : 96;
      return { top, bottom };
    };
    const start = async () => {
      try {
        const { createRisoEngine } = await import("./risoEngine");
        if (cancelled) return;
        engine = createRisoEngine({
          box: root,
          stage: stageRef.current,
          canvas: canvasRef.current,
          tag: tagRef.current,
          status: statusRef.current,
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
          onRegister: (value) => {
            if (!cancelled) setRegistered(value);
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
      className="riso-root"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
      data-failed={failed ? "" : undefined}
      data-registered={registered ? "" : undefined}
      style={{
        "--riso-ink0": `rgb(${POSTERS[active].inks[0].rgb.join(" ")})`,
        "--riso-ink1": `rgb(${POSTERS[active].inks[1].rgb.join(" ")})`,
      }}
    >
      <div
        ref={stageRef}
        className="riso-stage"
        tabIndex={0}
        role="application"
        aria-label="A gig poster printed as a two-colour risograph. Drag the ink, or the registration marks in the corners, to slide one plate against the other; let go near perfect registration and it clicks into place. Arrow keys nudge the current plate, Space switches plate, Enter registers it, and 1 to 3 change the poster."
      >
        <canvas ref={canvasRef} className="riso-canvas" />
        <span ref={tagRef} className="riso-tag" aria-hidden="true">
          <span className="riso-tag-ink" />
          <span className="riso-tag-label" />
        </span>
      </div>

      {embedded ? null : (
        <header ref={headRef} className="riso-head">
          <h1 className="riso-title">Riso Plates</h1>
          <p className="riso-lede">
            Two inks, two drums, one sheet. Slide the plates until they <em>click into register</em>.
          </p>
        </header>
      )}

      {embedded ? null : (
        <div ref={footRef} className="riso-panel">
          <div className="riso-presets" role="radiogroup" aria-label="Poster">
            {POSTERS.map((poster, i) => (
              <button
                key={poster.key}
                type="button"
                role="radio"
                aria-checked={active === i}
                aria-label={`${poster.label}, ${poster.inks[0].name} and ${poster.inks[1].name}`}
                className="riso-preset"
                onClick={() => engineRef.current?.select(i)}
              >
                <span className="riso-swatches" aria-hidden="true">
                  <span className="riso-swatch" style={{ "--riso-swatch": `rgb(${poster.inks[0].rgb.join(" ")})` }} />
                  <span className="riso-swatch" style={{ "--riso-swatch": `rgb(${poster.inks[1].rgb.join(" ")})` }} />
                </span>
                <span className="riso-preset-long">{poster.label}</span>
                <span className="riso-preset-short">{poster.short}</span>
              </button>
            ))}
          </div>
          <p className="riso-status">
            <span className="riso-status-mark" aria-hidden="true" />
            <span ref={statusRef} />
          </p>
        </div>
      )}

      {failed ? <p className="riso-fallback">This piece needs WebGL 2.</p> : null}
    </Root>
  );
}
