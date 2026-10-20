"use client";

import { useEffect, useRef, useState } from "react";

import useNearViewport from "@/app/experiments/useNearViewport";

import "./slime-type.css";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const headRef = useRef(null);
  const engineRef = useRef(null);
  const near = useNearViewport(rootRef);
  const [ready, setReady] = useState(false);
  const [close, setClose] = useState(false);

  useEffect(() => {
    if (!near) return undefined;
    let cancelled = false;
    let engine = null;
    const stage = stageRef.current;
    const insets = () => {
      const box = stage.getBoundingClientRect();
      const head = headRef.current?.getBoundingClientRect();
      return { top: head ? head.bottom - box.top + 24 : 24, bottom: 48 };
    };
    import("./slimeEngine").then(({ createSlime }) => {
      if (cancelled) return;
      engine = createSlime(stage, {
        canvas: canvasRef.current,
        insets,
        onReady: () => setReady(true),
      });
      engineRef.current = engine;
    });
    return () => {
      cancelled = true;
      engine?.destroy();
      engineRef.current = null;
    };
  }, [near]);

  const onKey = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const next = !close;
      setClose(next);
      engineRef.current?.magnify(next);
    } else if (e.key === "Escape" && close) {
      setClose(false);
      engineRef.current?.magnify(false);
    }
  };

  const onBlur = () => {
    if (!close) return;
    setClose(false);
    engineRef.current?.magnify(false);
  };

  return (
    <div ref={rootRef} className="slime-type" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      <div
        ref={stageRef}
        className="slime-type__stage"
        tabIndex={0}
        role="img"
        aria-label="A slime mould colony drawn in monospaced characters, its veins slowly growing into the word grow. Press and hold to look closer at the strands; drag across it to tear them apart and watch them regrow. Press Enter to toggle the close-up."
        onKeyDown={onKey}
        onBlur={onBlur}
      >
        <canvas ref={canvasRef} className="slime-type__canvas" />
      </div>

      {embedded ? null : (
        <header ref={headRef} className="slime-type__head">
          <h1 className="slime-type__title">Slime Mould</h1>
          <p className="slime-type__hint">Press and hold to look closer. Drag to tear it.</p>
        </header>
      )}
    </div>
  );
}
