"use client";

import { useEffect, useRef, useState } from "react";

import print from "./print-hats.webp";
import "./crumple.css";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const engineRef = useRef(null);
  const [status, setStatus] = useState("loading");
  const [held, setHeld] = useState(false);

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
        const made = await createCrumple({
          host: stage,
          root,
          src: print.src,
          reduced,
          onState: (on) => {
            if (!disposed) setHeld(on);
          },
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
  }, []);

  const onKeyDown = (e) => {
    if (e.repeat) return;
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      engineRef.current?.hold(true);
    }
  };

  const onKeyUp = (e) => {
    if (e.key === " " || e.key === "Enter") {
      e.preventDefault();
      engineRef.current?.hold(false);
    }
  };

  return (
    <div ref={rootRef} className="crumple" data-embedded={embedded || undefined} data-status={status} data-held={held || undefined}>
      <div
        ref={stageRef}
        className="crumple__stage"
        tabIndex={0}
        role="button"
        aria-pressed={held}
        aria-label="A photo print of bright sun hats on a wall, lying on a table. Press and hold to crumple it into a ball; let go and it slowly opens out again, keeping its creases."
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
      />
      {!embedded && (
        <header className="crumple__head">
          <h1 className="crumple__title">Crumple</h1>
          <p className="crumple__hint">
            Press and hold the print to crumple it. Let go and it <em>opens back out</em>, creases and all.
          </p>
        </header>
      )}
      {status === "failed" && <p className="crumple__fallback">This print needs WebGL to fold.</p>}
    </div>
  );
}
