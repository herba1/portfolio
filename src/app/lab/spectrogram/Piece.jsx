"use client";

import { useEffect, useRef, useState } from "react";

import "./spectrogram.css";

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
      const { createSpectrogram } = await import("./spectroEngine");
      if (cancelled) return;
      engine = createSpectrogram(stage, { embedded, input: inputRef.current, onLive: setLive });
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
    <Root className="spectrogram" data-embedded={embedded ? "" : undefined} data-ready={ready ? "" : undefined}>
      {embedded ? null : <h1 className="spectrogram-title">Spectrogram</h1>}
      <div ref={stageRef} className="spectrogram-stage" />
      <input
        ref={inputRef}
        className="spectrogram-input"
        type="text"
        inputMode="text"
        autoCapitalize="none"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        aria-label="Type a line to hear it drawn in the spectrogram"
        enterKeyHint="send"
      />
      <p className="spectrogram-live" aria-live="polite">
        {live}
      </p>
    </Root>
  );
}
