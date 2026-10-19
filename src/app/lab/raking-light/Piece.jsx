"use client";

import { useEffect, useRef, useState } from "react";

import "./raking-light.css";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const sliderRef = useRef(null);
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
      const head = headRef.current?.getBoundingClientRect();
      const foot = footRef.current?.getBoundingClientRect();
      if (boxRect.width >= 900) return { top: 96, bottom: 96 };
      const top = head ? head.bottom - boxRect.top + 16 : 140;
      const bottom = foot ? boxRect.bottom - foot.top + 16 : 96;
      return { top, bottom };
    };
    const start = async () => {
      try {
        const { createRakingEngine } = await import("./rakingEngine");
        if (cancelled) return;
        engine = createRakingEngine({
          box: root,
          stage: stageRef.current,
          canvas: canvasRef.current,
          slider: sliderRef.current,
          insets,
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
      className="raking-light-root"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
      data-failed={failed ? "" : undefined}
    >
      <div
        ref={stageRef}
        className="raking-light-stage"
        tabIndex={0}
        role="application"
        aria-label="Three album pieces on pale cotton: an Abbey Road enamel pin, an embroidered Revolver patch and a Sgt. Pepper drum badge, lit by one lamp held low. Move the pointer or the arrow keys to move the lamp; scroll, pinch or press plus and minus to raise and lower it."
      >
        <canvas ref={canvasRef} className="raking-light-canvas" />
      </div>

      {embedded ? null : (
        <header ref={headRef} className="raking-light-head">
          <h1 className="raking-light-title">Raking Light</h1>
          <p className="raking-light-lede">
            Hold the lamp low and the stitches, enamel and <em>raised gold</em> catch it.
          </p>
        </header>
      )}

      {embedded ? null : (
        <footer ref={footRef} className="raking-light-foot">
          <div className="raking-light-controls">
            <label className="raking-light-lamp">
              <span className="raking-light-lamp-label">Lamp height</span>
              <input
                ref={sliderRef}
                className="raking-light-range"
                type="range"
                min="0"
                max="1000"
                step="1"
                defaultValue="448"
                aria-label="Lamp height"
              />
            </label>
          </div>
        </footer>
      )}

      {failed ? <p className="raking-light-note">This piece needs WebGL 2.</p> : null}
    </Root>
  );
}
