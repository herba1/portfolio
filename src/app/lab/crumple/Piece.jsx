"use client";

import { useEffect, useRef, useState } from "react";
import "./crumple.css";

const LABELS = ["John, no. 01", "Paul, no. 02", "George, no. 03", "John, no. 04", "Paul, no. 05", "George, no. 06"];

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const engineRef = useRef(null);
  const [openIndex, setOpenIndex] = useState(-1);
  const [status, setStatus] = useState("loading");

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
        const { createCrumple } = await import("./crumpleEngine");
        if (disposed) return;
        const made = await createCrumple({ host: stage, root, embedded, reduced, onOpen: setOpenIndex });
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
    if (e.key === "Escape") engineRef.current?.close();
  };

  return (
    <div ref={rootRef} className="crumple" data-embedded={embedded || undefined} data-status={status} onKeyDown={onKeyDown}>
      <div ref={stageRef} className="crumple__stage" aria-hidden="true" />
      <div className="crumple__vignette" aria-hidden="true" />
      {!embedded && (
        <header className="crumple__head">
          <h1 className="crumple__title">Crumple</h1>
          <p className="crumple__hint">
            Throw a print, or tap one to <em>smooth it flat</em>.
          </p>
        </header>
      )}
      <div className="crumple__keys" role="group" aria-label="Prints">
        {LABELS.map((label, i) => (
          <button
            key={label}
            type="button"
            className="crumple__key"
            aria-pressed={openIndex === i}
            disabled={status !== "ready"}
            onClick={() => (openIndex === i ? engineRef.current?.close() : engineRef.current?.open(i))}
          >
            {label}
          </button>
        ))}
      </div>
      {status === "failed" && <p className="crumple__fallback">This piece needs WebGL to fold paper.</p>}
    </div>
  );
}
