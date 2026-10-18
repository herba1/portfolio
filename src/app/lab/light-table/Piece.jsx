"use client";

import { useEffect, useRef, useState } from "react";

import "./light-table.css";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const headRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let engine = null;
    const insets = () => {
      if (embedded) return { top: 16, bottom: 16 };
      const boxRect = root.getBoundingClientRect();
      const head = headRef.current?.getBoundingClientRect();
      const top = head ? head.bottom - boxRect.top + 24 : 152;
      return { top, bottom: boxRect.width >= 900 ? 40 : 24 };
    };
    const start = async () => {
      try {
        const { createLightTableEngine } = await import("./lightTableEngine");
        if (cancelled) return;
        engine = createLightTableEngine({
          box: root,
          stage: stageRef.current,
          canvas: canvasRef.current,
          insets,
          embedded,
          onReady: () => {
            if (!cancelled) setReady(true);
          },
          onFail: () => {
            if (!cancelled) setFailed(true);
          },
        });
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
    io.observe(root);
    return () => {
      cancelled = true;
      io.disconnect();
      engine?.destroy();
    };
  }, [embedded]);

  const Root = embedded ? "div" : "main";

  return (
    <Root
      ref={rootRef}
      className="light-table-root"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
      data-failed={failed ? "" : undefined}
    >
      <div
        ref={stageRef}
        className="light-table-stage"
        tabIndex={0}
        role="application"
        aria-label="A light table covered in mounted slides and colour negative strips shot from Beatles record sleeves, from With the Beatles to Let It Be. Drag the film to slide it across the glass; overlap two pieces to stack their colours. Arrow keys push the top piece, space sends it to the bottom of the pile."
      >
        <canvas ref={canvasRef} className="light-table-canvas" />
      </div>

      {embedded ? null : (
        <header ref={headRef} className="light-table-head">
          <h1 className="light-table-title">Light Table</h1>
          <p className="light-table-lede">
            Contact strips and slides from a sleeve shoot. Slide them around, stack two <em>into one picture</em>.
          </p>
        </header>
      )}

      {failed ? <p className="light-table-fallback">This piece needs WebGL 2.</p> : null}
    </Root>
  );
}
