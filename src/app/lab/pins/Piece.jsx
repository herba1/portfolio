"use client";

import { useEffect, useRef, useState } from "react";

import "./pins.css";

const STAGE_LABEL =
  "A pin art toy holding twenty thousand steel pins, with John Lennon's portrait pressed into them in relief. Press and drag to push pins forward from behind with your hand; they stay where you leave them. Shift-drag, or drag with two fingers, to tilt the toy so the pins slide back. Hold Space to press a hand in, hold the up and down arrows to tilt, Enter presses the portrait, and Backspace tips the pins back.";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const headRef = useRef(null);
  const barRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let engine = null;
    const insets = () => {
      const box = root.getBoundingClientRect();
      const bar = barRef.current?.getBoundingClientRect();
      const barSpace = bar && bar.height ? box.bottom - bar.top + 16 : 24;
      if (embedded) return { top: 20, right: 20, bottom: Math.max(20, barSpace), left: 20 };
      const head = headRef.current?.getBoundingClientRect();
      if (box.width >= 1100 && head) return { top: 88, right: 56, bottom: barSpace, left: head.right - box.left + 24 };
      const top = head ? head.bottom - box.top + 20 : 120;
      return { top, right: 16, bottom: barSpace, left: 16 };
    };
    const start = async () => {
      try {
        const { default: PinsEngine } = await import("./pinsEngine");
        if (cancelled) return;
        engine = new PinsEngine({
          host: stageRef.current,
          canvas: canvasRef.current,
          insets,
          onReady: () => {
            if (!cancelled) setReady(true);
          },
          onFail: () => {
            if (!cancelled) setFailed(true);
          },
          onBusy: (value) => {
            if (!cancelled) setBusy(value);
          },
        });
        engine.start();
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

  const onKeyDown = (e) => {
    const engine = engineRef.current;
    if (!engine) return;
    if (e.key === " ") {
      e.preventDefault();
      if (!e.repeat) engine.setKeyPress(true);
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      engine.setKeyLean(e.key === "ArrowUp" ? 0.36 : -0.3);
    } else if (e.key === "Enter") {
      e.preventDefault();
      engine.pressPortrait();
    } else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      engine.tipBack();
    }
  };

  const onKeyUp = (e) => {
    const engine = engineRef.current;
    if (!engine) return;
    if (e.key === " ") engine.setKeyPress(false);
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") engine.setKeyLean(0);
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root
      ref={rootRef}
      className="pins-root"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
      data-failed={failed ? "" : undefined}
    >
      <div
        ref={stageRef}
        className="pins-stage"
        tabIndex={0}
        role="application"
        aria-label={STAGE_LABEL}
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={() => {
          engineRef.current?.setKeyPress(false);
          engineRef.current?.setKeyLean(0);
        }}
      >
        <canvas ref={canvasRef} className="pins-canvas" />
      </div>

      {embedded ? null : (
        <header ref={headRef} className="pins-head">
          <h1 className="pins-title">Pin Art</h1>
          <p className="pins-lede">
            Press and drag to push the pins out from behind. Shift-drag or use two fingers to <em>tilt them back</em>.
          </p>
        </header>
      )}

      <div ref={barRef} className="pins-bar">
        <button type="button" className="pins-button" data-primary="" disabled={!ready || busy} onClick={() => engineRef.current?.pressPortrait()}>
          Press portrait
        </button>
        <button type="button" className="pins-button" disabled={!ready || busy} onClick={() => engineRef.current?.tipBack()}>
          Tip back
        </button>
      </div>

      {failed ? <p className="pins-fallback">This piece needs WebGL 2.</p> : null}
    </Root>
  );
}
