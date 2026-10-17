"use client";

import { useEffect, useRef, useState } from "react";

import { SLEEVES } from "./crateSleeves";
import "./crate.css";

const LABEL =
  "A wooden crate of records seen from above. Drag down or scroll to flip sleeves forward one by one; pull the front sleeve up to lift it out and slide the record half out. Arrow keys flip, Enter lifts the sleeve, Escape drops it.";

const pad = (n) => String(n).padStart(2, "0");

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const engineRef = useRef(null);
  const nowRef = useRef(null);
  const countRef = useRef(null);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    if (!root || !stage) return undefined;
    let disposed = false;
    let started = false;
    let visible = false;
    let engine = null;
    const reduced = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const sync = () => engine?.setActive(visible && !document.hidden);
    const onIndex = (i) => {
      const s = SLEEVES[i];
      if (nowRef.current)
        nowRef.current.textContent = `${s.artist}, ${s.title}`;
      if (countRef.current)
        countRef.current.textContent = `${pad(i + 1)} / ${pad(SLEEVES.length)}`;
    };
    const start = async () => {
      started = true;
      try {
        const { createCrate } = await import("./crateEngine");
        if (disposed) return;
        const made = await createCrate({
          host: stage,
          root,
          embedded,
          reduced,
          onIndex,
        });
        if (disposed) {
          made.destroy();
          return;
        }
        engine = made;
        engineRef.current = made;
        setStatus("ready");
        sync();
      } catch (error) {
        console.error(error);
        if (!disposed) setStatus("failed");
      }
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting;
        if (visible && !started) start();
        sync();
      },
      { rootMargin: "200px" },
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
    const engine = engineRef.current;
    if (!engine) return;
    if (e.key === "ArrowDown" || e.key === "ArrowRight") engine.step(1);
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") engine.step(-1);
    else if (e.key === "Home") engine.go(0);
    else if (e.key === "End") engine.go(SLEEVES.length - 1);
    else if (e.key === "Enter" || e.key === " ") engine.toggleLift();
    else if (e.key === "Escape") engine.drop();
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={rootRef}
      className="crate"
      data-embedded={embedded || undefined}
      data-status={status}
    >
      <div
        ref={stageRef}
        className="crate__stage"
        tabIndex={0}
        role="application"
        aria-label={LABEL}
        onKeyDown={onKeyDown}
      />
      <div className="crate__vignette" aria-hidden="true" />
      {!embedded && (
        <header className="crate__head">
          <h1 className="crate__title">Crate</h1>
          <p className="crate__hint">
            Drag down to dig. Pull a sleeve up to <em>see the record</em>.
          </p>
          <p className="crate__now" aria-live="polite">
            <span ref={countRef} className="crate__now-count" />
            <span ref={nowRef} className="crate__now-title" />
          </p>
        </header>
      )}
      {status === "failed" && (
        <p className="crate__fallback">
          This piece needs WebGL to open the crate.
        </p>
      )}
    </div>
  );
}
