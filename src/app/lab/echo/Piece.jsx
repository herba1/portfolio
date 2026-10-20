"use client";

import { useEffect, useRef, useState } from "react";

import "./echo.css";

export default function Piece({ embedded = false }) {
  const stageRef = useRef(null);
  const inputRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [live, setLive] = useState("");

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createEcho } = await import("./echoEngine");
      if (cancelled) return;
      engine = createEcho(stage, { embedded, input: inputRef.current, onLive: setLive });
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
    <Root className="echo" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      {embedded ? null : <h1 className="echo-title">Echo</h1>}
      <div ref={stageRef} className="echo-stage" />
      <input
        ref={inputRef}
        className="echo-input"
        type="text"
        inputMode="text"
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        aria-label="Type to play a note and hear its echoes"
        enterKeyHint="send"
      />
      <p className="echo-live" aria-live="polite">
        {live}
      </p>
    </Root>
  );
}
