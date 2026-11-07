"use client";

import { useEffect, useRef, useState } from "react";

import { START, wheelPositions } from "./tempoMath";
import "./tempo.css";

const ONES = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
const HUNDREDS = [" ", "1", "2", "3", " "];

function Wheel({ faces, pos, stripRef }) {
  return (
    <span className="tempo-wheel" aria-hidden="true">
      <span ref={stripRef} className="tempo-strip" style={{ transform: `translate3d(0, ${-pos}em, 0)` }}>
        {faces.map((f, i) => (
          <span key={i} className="tempo-face">
            {f}
          </span>
        ))}
      </span>
    </span>
  );
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const numberRef = useRef(null);
  const hRef = useRef(null);
  const tRef = useRef(null);
  const oRef = useRef(null);
  const rulerRef = useRef(null);
  const dotRef = useRef(null);
  const [ready, setReady] = useState(false);
  const init = wheelPositions(START);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createTempo } = await import("./tempoEngine");
      if (cancelled) return;
      engine = createTempo(root, {
        embedded,
        number: numberRef.current,
        strips: [hRef.current, tRef.current, oRef.current],
        ruler: rulerRef.current,
        dot: dotRef.current,
      });
      setReady(true);
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
      className="tempo-root"
      data-ready={ready ? "" : undefined}
      data-embedded={embedded ? "" : undefined}
      role="slider"
      tabIndex={0}
      aria-label="Tempo, beats per minute"
      aria-valuemin={30}
      aria-valuemax={300}
      aria-valuenow={START}
    >
      <div className="tempo-stack">
        <div ref={numberRef} className="tempo-number" style={{ "--tempo-shift": init.shift }}>
          <Wheel faces={HUNDREDS} pos={init.h} stripRef={hRef} />
          <Wheel faces={ONES} pos={init.t} stripRef={tRef} />
          <Wheel faces={ONES} pos={init.o} stripRef={oRef} />
        </div>
        <canvas ref={rulerRef} className="tempo-ruler" aria-hidden="true" />
        <span ref={dotRef} className="tempo-dot" aria-hidden="true" />
      </div>
    </Root>
  );
}
