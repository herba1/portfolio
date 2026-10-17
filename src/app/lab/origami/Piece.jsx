"use client";

import { useEffect, useRef, useState } from "react";

import "./origami.css";

const COUNT = ["Flat", "Folded once", "Folded twice", "Folded three times", "Folded four times", "Folded five times", "Folded six times"];

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const headRef = useRef(null);
  const engineRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [said, setSaid] = useState("");

  useEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    if (!root || !stage) return undefined;
    let disposed = false;
    let started = false;
    let visible = false;
    let engine = null;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const insets = () => {
      const rect = root.getBoundingClientRect();
      if (embedded) return { top: 20, bottom: 20, left: 20, right: 20 };
      if (rect.width >= 900) {
        const side = rect.width >= 1100 ? 48 : 296;
        return { top: 96, bottom: 48, left: side, right: 48 };
      }
      const head = headRef.current?.getBoundingClientRect();
      const top = head ? head.bottom - rect.top + 20 : 140;
      return { top, bottom: 28, left: 16, right: 16 };
    };
    const onState = (s) => {
      if (disposed) return;
      if (s.opening) setSaid("Opening the sheet flat.");
      else if (s.flat) setSaid("Opened flat. The creases stay.");
      else setSaid(COUNT[Math.min(COUNT.length - 1, s.folds)] + ".");
    };
    const sync = () => engine?.setActive(visible && !document.hidden);
    const start = async () => {
      started = true;
      try {
        const { createOrigami } = await import("./origamiEngine");
        if (disposed) return;
        const made = await createOrigami({ host: stage, root, embedded, reduced, insets, onState });
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
    const engine = engineRef.current;
    if (!engine) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      engine.foldNext();
    } else if (e.key === "Escape" || e.key === "Backspace" || e.key === "u" || e.key === "U") {
      e.preventDefault();
      engine.unfold();
    }
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root ref={rootRef} className="origami-root" data-embedded={embedded ? "" : undefined} data-status={status}>
      <div
        ref={stageRef}
        className="origami-stage"
        tabIndex={0}
        role="application"
        aria-label="A sheet of heavy washi paper printed with a 1909 Christy Mathewson baseball card, lying on dark felt. Drag any edge or corner across the sheet to fold it along a crease; let go past halfway and the fold sets. Double-click to open it flat again. Enter makes the next fold, Escape opens it."
        onKeyDown={onKeyDown}
      />
      <div className="origami-vignette" aria-hidden="true" />
      {embedded ? null : (
        <header ref={headRef} className="origami-head">
          <h1 className="origami-title">Origami</h1>
          <p className="origami-hint">
            Drag a corner across the sheet to fold it. <span className="origami-hint-fine">Double-click</span>
            <span className="origami-hint-touch">Double-tap</span> to <em>open it flat</em>.
          </p>
          <button type="button" className="origami-button" disabled={status !== "ready"} onClick={() => engineRef.current?.unfold()}>
            Unfold
          </button>
        </header>
      )}
      <p className="origami-live" aria-live="polite">
        {said}
      </p>
      {status === "failed" ? <p className="origami-fallback">This piece needs WebGL to fold paper.</p> : null}
    </Root>
  );
}
