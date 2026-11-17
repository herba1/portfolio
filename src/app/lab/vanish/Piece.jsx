"use client";

import { useEffect, useRef, useState } from "react";

import "./vanish.css";

const SEED = "the quiet part, out loud";

function readStill() {
  const raw = new URLSearchParams(window.location.search).get("t");
  if (raw == null) return null;
  const t = parseFloat(raw);
  return Number.isFinite(t) ? t : 0.42;
}

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const [value, setValue] = useState("");
  // idle: caret and placeholder shown. vanishing: both held back while the
  // line dissolves; typing at any point returns the field to idle at once.
  const [phase, setPhase] = useState("idle");

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let engine = null;
    const start = async () => {
      const { createVanish } = await import("./vanishEngine");
      await document.fonts?.ready;
      if (cancelled) return;
      engine = createVanish(
        { root, input: inputRef.current, canvas: canvasRef.current },
        { onSettle: () => setPhase("idle") },
      );
      engineRef.current = engine;
      const still = readStill();
      if (still != null) {
        const input = inputRef.current;
        input.value = SEED;
        input.focus({ preventScroll: true });
        engine.freeze(SEED, still);
        input.value = "";
        setValue("");
        setPhase("vanishing");
      } else if (!embedded) {
        inputRef.current?.focus({ preventScroll: true });
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
      engineRef.current = null;
    };
  }, [embedded]);

  const submit = () => {
    const input = inputRef.current;
    const engine = engineRef.current;
    const text = input.value;
    if (!engine || !text.trim()) return;
    const ok = engine.vanish(text, input.scrollLeft);
    if (!ok) return;
    input.value = "";
    setValue("");
    setPhase("vanishing");
    input.focus({ preventScroll: true });
  };

  const onKeyDown = (event) => {
    if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
    event.preventDefault();
    submit();
  };

  const onChange = (event) => {
    setValue(event.target.value);
    if (phase !== "idle") setPhase("idle");
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root ref={rootRef} className="vanish" data-embedded={embedded ? "" : undefined} data-phase={phase}>
      <form
        className="vanish-field"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <input
          ref={inputRef}
          className="vanish-input"
          type="text"
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          placeholder="Say it once"
          aria-label="Say it once, then press Enter to let it go"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          maxLength={160}
        />
        <span className="vanish-rule" aria-hidden="true" />
      </form>
      <canvas ref={canvasRef} className="vanish-canvas" aria-hidden="true" />
    </Root>
  );
}
