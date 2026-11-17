"use client";

import { useEffect, useRef, useState } from "react";

import { START, wheelPositions } from "./tempoMath";
import "./tempo.css";

const ONES = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
// The lead wheel only ever shows 1 to 3, so it sets proportional figures:
// Geist's plain 1 is a bare stem with a flag, where the tabular 1 grows a
// slab foot to fill its slot. Its faces are pushed to the right edge of the
// slot, and the empty part is taken back out by the engine. The blank faces
// are empty; a figure space would fall back to a wider glyph.
const HUNDREDS = ["", "1", "2", "3", ""];

function Wheel({ faces, pos, stripRef, lead = false }) {
  return (
    <span className={lead ? "tempo-wheel tempo-wheel--lead" : "tempo-wheel"} aria-hidden="true">
      <span ref={stripRef} className="tempo-strip" style={{ "--tempo-roll": pos }}>
        {faces.map((f, i) => (
          <span key={i} className="tempo-face" data-face={f || undefined}>
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
          <Wheel faces={HUNDREDS} pos={init.h} stripRef={hRef} lead />
          <Wheel faces={ONES} pos={init.t} stripRef={tRef} />
          <Wheel faces={ONES} pos={init.o} stripRef={oRef} />
        </div>
        <canvas ref={rulerRef} className="tempo-ruler" aria-hidden="true" />
      </div>
    </Root>
  );
}
