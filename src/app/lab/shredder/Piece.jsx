"use client";

import { useEffect, useRef, useState } from "react";

import { PHOTOS } from "./shredderArt";
import "./shredder.css";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const headRef = useRef(null);
  const footRef = useRef(null);
  const statusRef = useRef(null);
  const engineRef = useRef(null);
  const [photo, setPhoto] = useState(0);
  const [phase, setPhase] = useState("loading");

  useEffect(() => {
    const root = rootRef.current;
    const canvas = canvasRef.current;
    if (!root || !canvas) return undefined;
    let disposed = false;
    let started = false;
    let visible = false;
    let engine = null;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sync = () => engine?.setActive(visible && !document.hidden);
    const insets = () => {
      const box = root.getBoundingClientRect();
      if (embedded) return { top: 20, bottom: 16, left: 16, right: 16 };
      if (box.width >= 900) {
        const side = Math.min(320, box.width * 0.24);
        return { top: 92, bottom: 36, left: side, right: Math.max(48, side * 0.45) };
      }
      const head = headRef.current?.getBoundingClientRect();
      const foot = footRef.current?.getBoundingClientRect();
      return {
        top: head ? head.bottom - box.top + 12 : 140,
        bottom: foot ? box.bottom - foot.top + 12 : 80,
        left: 12,
        right: 12,
      };
    };
    const onStatus = ({ fused, total, fed, healing, through }) => {
      const node = statusRef.current;
      if (!node) return;
      if (healing) node.textContent = "Whole again  ·  reversing the cutter";
      else if (fused === total) node.textContent = through ? "Whole again" : "Whole again  ·  feed the rest through";
      else node.textContent = `${String(fed).padStart(2, "\u2007")}% fed  ·  ${fused}/${total} strips fused`;
    };
    const start = async () => {
      started = true;
      try {
        const { createShredder } = await import("./shredderEngine");
        if (disposed) return;
        const made = await createShredder({
          root,
          canvas,
          embedded,
          reduced,
          insets,
          onStatus,
          onPhoto: (i) => {
            if (!disposed) setPhoto(i);
          },
        });
        if (disposed) {
          made.destroy();
          return;
        }
        engine = made;
        engineRef.current = made;
        setPhase("ready");
        sync();
      } catch (error) {
        console.error(error);
        if (!disposed) setPhase("failed");
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
    if (e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      if (!e.repeat) engine.feed(true);
      return;
    }
    if (e.key === "Enter" || e.key === "c" || e.key === "C") {
      e.preventDefault();
      engine.combPass();
      return;
    }
    const n = Number(e.key);
    if (n >= 1 && n <= PHOTOS.length) engine.select(n - 1);
  };

  const onKeyUp = (e) => {
    if (e.key === " " || e.key === "ArrowDown") engineRef.current?.feed(false);
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root ref={rootRef} className="shredder-root" data-embedded={embedded ? "" : undefined} data-phase={phase}>
      <canvas
        ref={canvasRef}
        className="shredder-canvas"
        tabIndex={0}
        role="application"
        aria-label="A strip-cut shredder with a landscape print half fed into its slot and the cut strips hanging below. Drag the print down, or press and hold Space, to feed it. Drag across the hanging strips to comb them straight; aligned strips fuse into the next photograph. Enter combs the strips, 1 to 3 choose the print."
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={() => engineRef.current?.feed(false)}
      />
      {embedded ? null : (
        <header ref={headRef} className="shredder-head">
          <h1 className="shredder-title">Shredder</h1>
          <p className="shredder-lede">
            Feed the print through the cutter, then comb the strips. Where they line up they fuse into <em>the next photograph</em>.
          </p>
        </header>
      )}
      {embedded ? null : (
        <div ref={footRef} className="shredder-panel">
          <div className="shredder-presets" role="radiogroup" aria-label="Print">
            {PHOTOS.map((p, i) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={photo === i}
                aria-label={p.title}
                className="shredder-preset"
                disabled={phase !== "ready"}
                onClick={() => engineRef.current?.select(i)}
              >
                <span className="shredder-thumb" aria-hidden="true" style={{ backgroundImage: `url(${p.src})` }} />
                <span className="shredder-preset-long">{p.title}</span>
                <span className="shredder-preset-short">{p.short}</span>
              </button>
            ))}
          </div>
          <p className="shredder-status" aria-live="off">
            <span ref={statusRef} />
          </p>
        </div>
      )}
      {phase === "failed" ? <p className="shredder-fallback">This piece needs WebGL 2.</p> : null}
    </Root>
  );
}
