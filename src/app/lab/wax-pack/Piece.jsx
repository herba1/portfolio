"use client";

import { useEffect, useRef, useState } from "react";

import "./wax-pack.css";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const headRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [phase, setPhase] = useState("sealed");
  const [status, setStatus] = useState("");

  useEffect(() => {
    const root = rootRef.current;
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!root || !stage || !canvas) return undefined;
    let cancelled = false;
    let engine = null;
    const insets = () => {
      if (embedded) return { top: 24, bottom: 24, left: 20, right: 20 };
      const box = root.getBoundingClientRect();
      if (box.width >= 900) return { top: 96, bottom: 40, left: 48, right: 48 };
      const head = headRef.current?.getBoundingClientRect();
      const top = head ? head.bottom - box.top + 24 : 160;
      return { top, bottom: 72, left: 16, right: 16 };
    };
    const onChange = (change) => {
      if (cancelled) return;
      if (change.phase) setPhase(change.phase);
      if (change.message) setStatus(change.message);
    };
    const start = async () => {
      try {
        const { createWaxPack } = await import("./waxEngine");
        if (cancelled) return;
        engine = await createWaxPack(stage, canvas, { embedded, onChange, insets });
        if (cancelled) {
          engine.destroy();
          return;
        }
        engineRef.current = engine;
        setReady(true);
      } catch (error) {
        console.error(error);
        if (!cancelled) setFailed(true);
      }
    };
    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        io.disconnect();
        start();
      },
      { rootMargin: "240px" },
    );
    io.observe(stage);
    return () => {
      cancelled = true;
      io.disconnect();
      engine?.destroy();
      engineRef.current = null;
    };
  }, [embedded]);

  const onKeyDown = (event) => {
    const engine = engineRef.current;
    if (!engine || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      engine.key("next");
      return;
    }
    if (event.key === "f" || event.key === "F") {
      if (engine.key("flip")) event.preventDefault();
      return;
    }
    if (event.key === "n" || event.key === "N") {
      event.preventDefault();
      engine.reset();
    }
  };

  const Root = embedded ? "div" : "main";
  const open = phase === "open";

  return (
    <Root
      ref={rootRef}
      className="wax-pack-root"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
      data-open={open ? "" : undefined}
    >
      <div ref={stageRef} className="wax-pack-stage">
        <canvas
          ref={canvasRef}
          className="wax-pack-canvas"
          tabIndex={0}
          role="application"
          aria-label="A sealed wax pack of baseball cards on a table. Drag down from the tab at the top to tear the wrapper open, then drag or flick cards off the stack. Drag a dealt card to turn it over. With the keyboard, Enter tears the pack and deals the next card, F turns the last card over, and N opens a new pack."
          onKeyDown={onKeyDown}
        />
        {failed ? <p className="wax-pack-fallback">This piece needs WebGL 2.</p> : null}
      </div>
      {embedded ? null : (
        <header ref={headRef} className="wax-pack-head">
          <h1 className="wax-pack-title">Wax Pack</h1>
          <p className="wax-pack-hint">
            Pull the tab and tear the wrapper open. Flick the cards out, then drag one to <em>turn it over</em>.
          </p>
          <button
            type="button"
            className="wax-pack-button"
            data-show={phase !== "sealed" ? "" : undefined}
            tabIndex={phase !== "sealed" ? 0 : -1}
            onClick={() => engineRef.current?.reset()}
          >
            New pack
          </button>
        </header>
      )}
      {embedded ? (
        <button
          type="button"
          className="wax-pack-button wax-pack-button-corner"
          data-show={open ? "" : undefined}
          tabIndex={open ? 0 : -1}
          onClick={() => engineRef.current?.reset()}
        >
          New pack
        </button>
      ) : null}
      <p className="wax-pack-live" aria-live="polite">
        {status}
      </p>
    </Root>
  );
}
