"use client";

import { useEffect, useRef, useState } from "react";

import "./tempo.css";

export default function Piece({ embedded = false }) {
  const stageRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [live, setLive] = useState("");

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    let cancelled = false;
    let engine = null;
    let sounded = false;
    const onGesture = () => {
      if (sounded || !engine) return;
      sounded = true;
      engine.setSound(true);
    };
    const start = async () => {
      const { createTempo } = await import("./tempoEngine");
      if (cancelled) return;
      engine = createTempo(stage, { embedded, onLive: setLive, onGesture });
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
    io.observe(stage);
    return () => {
      cancelled = true;
      io.disconnect();
      engine?.destroy();
    };
  }, [embedded]);

  const Root = embedded ? "div" : "main";

  return (
    <Root className="tempo" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      {embedded ? null : <h1 className="tempo-title">Tempo</h1>}
      <div ref={stageRef} className="tempo-stage" />
      <p className="tempo-live" aria-live="polite">
        {live}
      </p>
    </Root>
  );
}
