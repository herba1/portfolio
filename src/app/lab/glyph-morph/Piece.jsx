"use client";

import { useEffect, useRef, useState } from "react";

import "./glyphMorph.css";

export default function Piece({ embedded = false }) {
  const stageRef = useRef(null);
  const [live, setLive] = useState("");

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createGlyphMorph } = await import("./glyphMorphEngine");
      if (cancelled) return;
      engine = await createGlyphMorph(stage, { embedded, onLive: setLive });
      if (cancelled) engine?.destroy();
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
    };
  }, [embedded]);

  const Root = embedded ? "div" : "main";
  return (
    <Root className="gm" data-embedded={embedded ? "" : undefined}>
      {embedded ? null : <h1 className="gm-sr">Glyph Morph</h1>}
      <div ref={stageRef} className="gm-stage" />
      <p className="gm-sr" aria-live="polite">
        {live}
      </p>
    </Root>
  );
}
