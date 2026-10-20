"use client";

import { useEffect, useRef, useState } from "react";

import useNearViewport from "@/app/experiments/useNearViewport";

import { SETLIST } from "./ghostSet";
import "./ghost-setlist.css";

const STAGE_LABEL =
  "A setlist as lit lettering on black, set along an arc. Drag, scroll or flick to move through the songs; each one leaves outline afterimages while it travels the curve and lands lit at the centre. Arrow keys step one song, Home and End jump to the first and last.";

const pad = (n) => String(n).padStart(2, "0");

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const near = useNearViewport(rootRef);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!near) return undefined;
    const root = rootRef.current;
    let cancelled = false;
    let engine = null;
    const boot = async () => {
      const { default: GhostEngine } = await import("./ghostEngine");
      if (cancelled) return;
      engine = new GhostEngine({
        host: stageRef.current,
        canvas: canvasRef.current,
        embedded,
        onSelect: (index) => {
          if (!cancelled) setActive(index);
        },
        onReady: () => root.setAttribute("data-ready", ""),
        onFail: () => root.setAttribute("data-failed", ""),
        onGrab: (down) => {
          if (down) root.setAttribute("data-grabbing", "");
          else root.removeAttribute("data-grabbing");
        },
      });
      engineRef.current = engine;
      engine.start();
    };
    boot().catch((error) => {
      console.error(error);
      root.setAttribute("data-failed", "");
    });
    return () => {
      cancelled = true;
      engine?.destroy();
      engineRef.current = null;
    };
  }, [near, embedded]);

  const onKey = (e) => {
    const engine = engineRef.current;
    if (!engine) return;
    const next = ["ArrowRight", "ArrowDown", "PageDown"].includes(e.key) || (e.key === " " && !e.shiftKey);
    const prev = ["ArrowLeft", "ArrowUp", "PageUp"].includes(e.key) || (e.key === " " && e.shiftKey);
    if (next) engine.step(1);
    else if (prev) engine.step(-1);
    else if (e.key === "Home") engine.first();
    else if (e.key === "End") engine.lastTrack();
    else return;
    e.preventDefault();
  };

  const Root = embedded ? "div" : "main";
  const song = SETLIST[active];

  return (
    <Root ref={rootRef} className="ghost-setlist" data-embedded={embedded ? "" : undefined}>
      <div
        ref={stageRef}
        className="ghost-setlist-stage"
        tabIndex={0}
        role="application"
        aria-label={STAGE_LABEL}
        aria-roledescription="setlist"
        onKeyDown={onKey}
      >
        <canvas ref={canvasRef} className="ghost-setlist-canvas" />
      </div>

      {embedded ? null : <h1 className="ghost-setlist-sr">Ghost Setlist</h1>}

      <p className="ghost-setlist-live" aria-live="polite">
        {`${pad(active + 1)} of ${pad(SETLIST.length)}, ${song.title}${song.encore ? ", encore" : ""}`}
      </p>

      <p className="ghost-setlist-fallback">This piece needs WebGL 2.</p>
    </Root>
  );
}
