"use client";

import { useEffect, useRef, useState } from "react";

import { WEAVES } from "./loomLyrics";
import "./lyric-loom.css";

const CLOTH_LABEL =
  "A woven cloth of printed cotton tapes, each tape carrying a line of lyrics from a late-night set. Drag anywhere on the cloth to pull the threads; they stretch toward your hand, the weave opens onto a warm light behind it, and they settle back when you let go. Flick to send a ripple through it. Arrow keys push the cloth, Enter sends a ripple, and 1 to 3 change the weave.";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const lightRef = useRef(null);
  const headRef = useRef(null);
  const footRef = useRef(null);
  const engineRef = useRef(null);
  const [weave, setWeave] = useState(WEAVES[0].id);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let engine = null;
    const insets = (width) => {
      if (embedded) return { top: 20, bottom: 20, left: 20, right: 20 };
      if (width >= 900) return { top: 104, bottom: 48, left: 312, right: width >= 1180 ? 312 : 48 };
      const box = root.getBoundingClientRect();
      const head = headRef.current?.getBoundingClientRect();
      const foot = footRef.current?.getBoundingClientRect();
      const top = head ? head.bottom - box.top + 20 : 150;
      const bottom = foot ? box.bottom - foot.top + 20 : 84;
      return { top, bottom, left: 16, right: 16 };
    };
    const start = async () => {
      try {
        const { createLoomEngine } = await import("./loomEngine");
        if (cancelled) return;
        engine = createLoomEngine({
          root,
          stage: stageRef.current,
          canvas: canvasRef.current,
          backlight: lightRef.current,
          insets,
          embedded,
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

  const chooseWeave = (id) => {
    setWeave(id);
    engineRef.current?.setWeave(id);
  };

  const onKeyDown = (e) => {
    const index = Number(e.key) - 1;
    if (index >= 0 && index < WEAVES.length) {
      e.preventDefault();
      chooseWeave(WEAVES[index].id);
    }
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root
      ref={rootRef}
      className="lyric-loom"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
      data-failed={failed ? "" : undefined}
    >
      <div ref={lightRef} className="lyric-loom-light" aria-hidden="true">
        <div className="lyric-loom-light-img" />
      </div>
      <div
        ref={stageRef}
        className="lyric-loom-stage"
        tabIndex={0}
        role="application"
        aria-label={CLOTH_LABEL}
        onKeyDown={onKeyDown}
      >
        <canvas ref={canvasRef} className="lyric-loom-canvas" />
      </div>

      {embedded ? null : (
        <header ref={headRef} className="lyric-loom-head">
          <h1 className="lyric-loom-title">Lyric Loom</h1>
          <p className="lyric-loom-lede">
            A late set, woven on cotton tape. Grab the cloth and pull; <em>flick it</em> to send a ripple through.
          </p>
        </header>
      )}

      {embedded ? null : (
        <div ref={footRef} className="lyric-loom-panel">
          <div className="lyric-loom-weaves" role="radiogroup" aria-label="Weave">
            {WEAVES.map((w) => (
              <button
                key={w.id}
                type="button"
                role="radio"
                aria-checked={weave === w.id}
                aria-label={`${w.label}: ${w.note}`}
                title={w.note}
                className="lyric-loom-weave"
                onClick={() => chooseWeave(w.id)}
              >
                <span className={`lyric-loom-swatch lyric-loom-swatch-${w.id}`} aria-hidden="true" />
                {w.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {failed ? <p className="lyric-loom-fallback">This piece needs WebGL 2.</p> : null}
    </Root>
  );
}
