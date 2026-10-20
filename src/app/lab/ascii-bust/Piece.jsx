"use client";

import { useEffect, useRef, useState } from "react";

import "./ascii-bust.css";

const STAGE_LABEL =
  "A marble bust of John Lennon typed in monospace characters on paper. Drag sideways to turn it on its turntable and let go to let it coast; the light follows your pointer. Left and right arrows spin it, Home returns it to three-quarter view.";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const statusRef = useRef(null);
  const headRef = useRef(null);
  const footRef = useRef(null);
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
      if (boxRect.width >= 900) return { top: 88, bottom: 40 };
      const head = headRef.current?.getBoundingClientRect();
      const foot = footRef.current?.getBoundingClientRect();
      const top = head ? head.bottom - boxRect.top + 16 : 140;
      const bottom = foot ? boxRect.bottom - foot.top + 12 : 56;
      return { top, bottom };
    };
    const start = async () => {
      try {
        const { createBustEngine } = await import("./bustEngine");
        if (cancelled) return;
        engine = createBustEngine({
          box: root,
          stage: stageRef.current,
          canvas: canvasRef.current,
          status: statusRef.current,
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
      className="ascii-bust-root"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
      data-failed={failed ? "" : undefined}
    >
      <div ref={stageRef} className="ascii-bust-stage" tabIndex={0} role="application" aria-label={STAGE_LABEL}>
        <canvas ref={canvasRef} className="ascii-bust-canvas" />
      </div>

      {embedded ? null : (
        <header ref={headRef} className="ascii-bust-head">
          <h1 className="ascii-bust-title">Type Bust</h1>
          <p className="ascii-bust-lede">
            John Lennon in Geist Mono. Drag to turn him; every character <em>re-sets itself</em> to follow the form.
          </p>
        </header>
      )}

      {embedded ? null : (
        <p ref={footRef} className="ascii-bust-status">
          <span className="ascii-bust-dial" aria-hidden="true" />
          <span ref={statusRef} aria-live="off" />
        </p>
      )}

      {failed ? <p className="ascii-bust-fallback">This piece needs WebGL 2.</p> : null}
    </Root>
  );
}
