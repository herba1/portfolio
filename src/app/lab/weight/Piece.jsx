"use client";

import { useEffect, useRef, useState } from "react";

import "./weight.css";

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
      const { createWeight } = await import("./weightEngine");
      if (cancelled) return;
      engine = createWeight(stage, { embedded, onLive: setLive, onGesture });
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
    <Root className="weight" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      {embedded ? null : <h1 className="weight-title">Weight</h1>}
      <div ref={stageRef} className="weight-stage" />
      <p className="weight-live" aria-live="polite">
        {live}
      </p>
    </Root>
  );
}
