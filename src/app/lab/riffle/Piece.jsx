"use client";

import { useEffect, useRef, useState } from "react";

import "./riffle.css";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const canvasRef = useRef(null);
  const headRef = useRef(null);
  const engineRef = useRef(null);
  const [frame, setFrame] = useState(0);
  const [wide, setWide] = useState(true);

  useEffect(() => {
    const root = rootRef.current;
    let engine = null;
    let cancelled = false;
    const insets = () => {
      if (embedded) return { top: 16, bottom: 16, side: 16 };
      const boxRect = root.getBoundingClientRect();
      const head = headRef.current?.getBoundingClientRect();
      const top = head ? head.bottom - boxRect.top + 24 : 120;
      return { top, bottom: 32, side: boxRect.width >= 900 ? 48 : 16 };
    };
    import("./riffleEngine")
      .then(({ createRiffleEngine }) => {
        if (cancelled) return;
        engine = createRiffleEngine({
          box: root,
          stage: stageRef.current,
          canvas: canvasRef.current,
          insets,
          embedded,
          onReady: () => {
            root.dataset.ready = "true";
            setWide(engine.wide());
          },
          onFail: () => {
            root.dataset.fallback = "true";
          },
          onFrame: (i) => {
            setFrame(i);
            setWide(engine.wide());
          },
        });
        engineRef.current = engine;
      })
      .catch(() => {
        root.dataset.fallback = "true";
      });
    return () => {
      cancelled = true;
      engine?.destroy();
      engineRef.current = null;
    };
  }, [embedded]);

  return (
    <div ref={rootRef} className="riffle" data-embedded={embedded ? "" : undefined}>
      <div
        ref={stageRef}
        className="riffle__stage"
        tabIndex={0}
        role="application"
        aria-label="A flip book of 24 pencil drawings of Joe Tinker swinging a bat. Press the corner of the stack and drag toward the binding to riffle the pages; drag back to play it in reverse. Arrow keys turn one page, Space plays it through, Home goes back to the start."
      >
        <canvas ref={canvasRef} className="riffle__canvas" />
        <div className="riffle__fallback" role="img" aria-label="Joe Tinker, Chicago, 1909 baseball card" />
      </div>

      {!embedded && (
        <header ref={headRef} className="riffle__head">
          <h1 className="riffle__title">Riffle</h1>
          <p className="riffle__lede">
            Thumb the corner and drag {wide ? "left" : "up"}. How fast you go is <em>the frame rate</em>.
          </p>
        </header>
      )}

      <p className="riffle__live" aria-live="polite">
        {`Frame ${frame + 1} of 24`}
      </p>
    </div>
  );
}
