"use client";

import { useEffect, useRef, useState } from "react";

import useNearViewport from "@/app/experiments/useNearViewport";

import "./scoreboard.css";

const BOARD_LABEL =
  "A hand-operated ballpark scoreboard, Gulls against Millers in the bottom of the 6th. Drag a number plate from the rack below into any inning slot, or pull one out to swap it; the runs total updates itself. With the keyboard, arrow keys pick a slot, a digit key hangs that plate, and Backspace takes it down.";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const headRef = useRef(null);
  const near = useNearViewport(rootRef);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!near) return undefined;
    const root = rootRef.current;
    const stage = stageRef.current;
    let engine = null;
    let cancelled = false;
    const insets = () => {
      if (embedded) return { top: 12, bottom: 12 };
      const box = root.getBoundingClientRect();
      const head = headRef.current?.getBoundingClientRect();
      const top = head ? head.bottom - box.top + (box.width >= 900 ? 24 : 16) : 140;
      return { top, bottom: box.width >= 900 ? 40 : 20 };
    };
    import("./scoreboardEngine")
      .then(({ default: ScoreboardEngine }) => {
        if (cancelled) return;
        engine = new ScoreboardEngine({
          host: stage,
          canvas: canvasRef.current,
          insets,
          onReady: () => root.setAttribute("data-ready", ""),
          onStatus: (text) => {
            if (!cancelled) setStatus(text);
          },
        });
        engine.start();
      })
      .catch((error) => {
        console.error(error);
        root.setAttribute("data-failed", "");
      });
    return () => {
      cancelled = true;
      engine?.destroy();
    };
  }, [near, embedded]);

  return (
    <div ref={rootRef} className="scoreboard" data-embedded={embedded ? "" : undefined}>
      <div ref={stageRef} className="scoreboard__stage" tabIndex={0} role="application" aria-label={BOARD_LABEL}>
        <canvas ref={canvasRef} className="scoreboard__canvas" />
      </div>

      {!embedded && (
        <header ref={headRef} className="scoreboard__head">
          <h1 className="scoreboard__title">Scoreboard</h1>
          <p className="scoreboard__lede">
            Hang a plate in any inning. It drops on its rails and the runs <em>add themselves up</em>.
          </p>
        </header>
      )}

      <p className="scoreboard__status" aria-live="polite">
        {status}
      </p>
    </div>
  );
}
