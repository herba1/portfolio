"use client";

import { useEffect, useRef, useState } from "react";

import "./playcount.css";

const START = 1284903;
const format = (n) => n.toLocaleString("en-US");

// ?still=type|roll&t=0.1 holds the motion at a moment, for stills.
function readStill() {
  if (typeof window === "undefined") return null;
  const q = new URLSearchParams(window.location.search);
  const mode = q.get("still");
  if (!mode) return null;
  return { mode, t: Math.max(0, Number(q.get("t") ?? 0.1)) };
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const inputRef = useRef(null);
  const [value, setValue] = useState(START);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let engine = null;
    const still = readStill();
    const start = async () => {
      const { createPlayCount } = await import("./playCountEngine");
      if (cancelled) return;
      const initial = still?.mode === "type" ? 12345 : still?.mode === "roll" ? 999998 : START;
      engine = createPlayCount(root, {
        stage: stageRef.current,
        input: inputRef.current,
        embedded,
        initial,
        onValue: setValue,
      });
      await engine.ready;
      await new Promise((r) => requestAnimationFrame(r));
      if (cancelled) return;
      if (still) {
        if (still.mode === "type") engine.type(6);
        else engine.set(1000004, "value");
        engine.freezeAt(still.t);
      } else if (!embedded) {
        engine.focus();
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
      className="playcount"
      data-embedded={embedded ? "" : undefined}
      data-focus={focused ? "" : undefined}
    >
      <div ref={stageRef} className="playcount-stage" />
      <input
        ref={inputRef}
        className="playcount-input"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        role="spinbutton"
        aria-label="Play count"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuetext={`${format(value)} plays`}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        defaultValue=""
      />
    </Root>
  );
}
