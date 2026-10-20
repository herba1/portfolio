"use client";

import { useEffect, useRef, useState } from "react";

import useNearViewport from "@/app/experiments/useNearViewport";

import { POEM } from "./ghostTypeEngine";
import "./ghost-type.css";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const headRef = useRef(null);
  const footRef = useRef(null);
  const engineRef = useRef(null);
  const near = useNearViewport(rootRef);
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(null);

  useEffect(() => {
    if (!near) return undefined;
    let cancelled = false;
    let engine = null;
    const stage = stageRef.current;
    const insets = () => {
      const box = stage.getBoundingClientRect();
      const head = headRef.current?.getBoundingClientRect();
      const foot = footRef.current?.getBoundingClientRect();
      return {
        top: head ? head.bottom - box.top + 48 : 40,
        bottom: foot ? box.bottom - foot.top + 40 : 40,
        roof: head ? head.bottom - box.top + 16 : 16,
        floor: foot ? foot.top - box.top - 16 : box.height - 16,
      };
    };
    import("./ghostTypeEngine").then(({ createGhostType }) => {
      if (cancelled) return;
      engine = createGhostType(stage, {
        canvas: canvasRef.current,
        insets,
        onReady: () => setReady(true),
        onActive: setActive,
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
      engineRef.current?.release();
    }
  };

  return (
    <div ref={rootRef} className="ghost-type" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      <div
        ref={stageRef}
        className="ghost-type__stage"
        tabIndex={0}
        role="img"
        aria-label={`${POEM.join(" ")} A poem by Christina Rossetti set as a justified block. Pull any word out of the block and it trails outlined ghosts as it flies back home. Press Enter to send a word drifting.`}
        onKeyDown={onKey}
      >
        <canvas ref={canvasRef} className="ghost-type__canvas" />
      </div>

      {embedded ? null : (
        <header ref={headRef} className="ghost-type__head">
          <h1 className="ghost-type__title">Ghost Type</h1>
          <p className="ghost-type__hint">Pull any word out of the poem and let go.</p>
        </header>
      )}

      <footer ref={footRef} className="ghost-type__foot">
        <p className="ghost-type__credit">
          Who Has Seen the Wind? Christina Rossetti, 1872
        </p>
      </footer>
      <p className="ghost-type__live" aria-live="polite">
        {active ? `Holding “${active}”` : ""}
      </p>
    </div>
  );
}
