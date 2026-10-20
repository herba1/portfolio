"use client";

import { useEffect, useRef, useState } from "react";

import "./strike.css";

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
      const { createStrike } = await import("./strikeEngine");
      if (cancelled) return;
      engine = createStrike(stage, { embedded, onLive: setLive, onGesture });
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
    <Root className="strike" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      {embedded ? null : <h1 className="strike-title">Strike</h1>}
      <div ref={stageRef} className="strike-stage" />
      <p className="strike-live" aria-live="polite">
        {live}
      </p>
    </Root>
  );
}
