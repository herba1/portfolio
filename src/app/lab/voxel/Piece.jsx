"use client";

import { useEffect, useRef, useState } from "react";
import "./voxel.css";

const STAGE_LABEL =
  "A club photograph printed as a field of small cubes on a pale floor. Press Enter to lift it into a heap of cubes, and H to call every cube home.";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const engineRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [out, setOut] = useState(0);

  useEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    if (!root || !stage) return undefined;
    let disposed = false;
    let started = false;
    let visible = false;
    let engine = null;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sync = () => engine?.setActive(visible && !document.hidden);
    const start = async () => {
      started = true;
      try {
        const { createVoxel } = await import("./voxelEngine");
        if (disposed) return;
        const made = await createVoxel({ host: stage, root, embedded, reduced, onState: (s) => setOut(s.out) });
        if (disposed) {
          made.destroy();
          return;
        }
        engine = made;
        engineRef.current = made;
        setStatus("ready");
        sync();
      } catch {
        if (!disposed) setStatus("failed");
      }
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible && !started) start();
        sync();
      },
      { rootMargin: "160px" },
    );
    io.observe(root);
    document.addEventListener("visibilitychange", sync);
    return () => {
      disposed = true;
      io.disconnect();
      document.removeEventListener("visibilitychange", sync);
      engine?.destroy();
      engineRef.current = null;
    };
  }, [embedded]);

  const onKeyDown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      engineRef.current?.lift();
    } else if (e.key === "h" || e.key === "H") {
      e.preventDefault();
      engineRef.current?.callHome();
    }
  };

  return (
    <div ref={rootRef} className="voxel" data-embedded={embedded || undefined} data-status={status}>
      <div
        ref={stageRef}
        className="voxel__stage"
        tabIndex={0}
        role="application"
        aria-label={STAGE_LABEL}
        onKeyDown={onKeyDown}
      />
      {!embedded && (
        <header className="voxel__head">
          <h1 className="voxel__title">Voxel</h1>
          <p className="voxel__hint">
            Tap the print to lift it. Stir the heap, then <em>call it home</em>.
          </p>
        </header>
      )}
      <div className="voxel__bar">
        <button
          type="button"
          className="voxel__home"
          disabled={status !== "ready" || out === 0}
          onClick={() => engineRef.current?.callHome()}
        >
          <svg className="voxel__icon" viewBox="0 0 16 16" aria-hidden="true">
            <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
            <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
            <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
            <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
          </svg>
          <span>Call home</span>
        </button>
      </div>
      {status === "failed" && <p className="voxel__fallback">This piece needs WebGL to stack its cubes.</p>}
    </div>
  );
}
