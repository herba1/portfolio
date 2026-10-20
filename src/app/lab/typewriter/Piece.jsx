"use client";

import { useEffect, useRef, useState } from "react";

import "./typewriter.css";

const STAGE_LABEL =
  "A single sheet of paper under a typewriter's stamper, with the liner notes for Revolver already typed on the sheet. Type on your keyboard to strike the paper; Return throws the carriage back and advances the line, Backspace steps back so you can overtype, and the arrow keys roll the sheet. Drag the sheet sideways to move the carriage or up and down to roll it. On a touch screen, tap the sheet to type.";

const KEY_FOR_INPUT = {
  insertLineBreak: "Enter",
  insertParagraph: "Enter",
  deleteContentBackward: "Backspace",
};

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const stageRef = useRef(null);
  const glRef = useRef(null);
  const overlayRef = useRef(null);
  const headRef = useRef(null);
  const typeRef = useRef(null);
  const tapRef = useRef(null);
  const engineRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const [sound, setSound] = useState(true);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return undefined;
    let cancelled = false;
    let engine = null;
    const insets = () => {
      const box = root.getBoundingClientRect();
      const head = headRef.current?.getBoundingClientRect();
      const top = head && head.height ? head.bottom - box.top : 12;
      return { top, bottom: embedded ? 12 : 56 };
    };
    const start = async () => {
      try {
        const { default: TypewriterEngine } = await import("./typewriterEngine");
        if (cancelled) return;
        engine = new TypewriterEngine({
          stage: stageRef.current,
          glCanvas: glRef.current,
          overlay: overlayRef.current,
          embedded,
          insets,
          onReady: () => {
            if (!cancelled) setReady(true);
          },
          onFail: () => {
            if (!cancelled) setFailed(true);
          },
        });
        engineRef.current = engine;
        await engine.start();
      } catch (error) {
        console.error(error);
        if (!cancelled) setFailed(true);
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

  useEffect(() => {
    const input = typeRef.current;
    if (!input) return undefined;
    const strike = (key) => {
      engineRef.current?.keyDown({ key, target: null, repeat: false, preventDefault() {} });
    };
    const onBeforeInput = (e) => {
      e.preventDefault();
      const mapped = KEY_FOR_INPUT[e.inputType];
      if (mapped) {
        strike(mapped);
        return;
      }
      for (const ch of e.data || "") strike(ch === "\n" ? "Enter" : ch);
    };
    const onKeyDown = (e) => {
      if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        strike(e.key);
      }
    };
    input.addEventListener("beforeinput", onBeforeInput);
    input.addEventListener("keydown", onKeyDown);
    return () => {
      input.removeEventListener("beforeinput", onBeforeInput);
      input.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const onStageDown = (e) => {
    e.currentTarget.setAttribute("data-pointer", "");
    tapRef.current = e.pointerType === "mouse" ? null : { x: e.clientX, y: e.clientY, t: e.timeStamp };
  };

  const onStageUp = (e) => {
    const tap = tapRef.current;
    tapRef.current = null;
    if (!tap || Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8 || e.timeStamp - tap.t > 400) return;
    typeRef.current?.focus({ preventScroll: true });
  };

  const toggleSound = () => {
    const next = !sound;
    setSound(next);
    engineRef.current?.setSound(next);
  };

  const Root = embedded ? "div" : "main";

  return (
    <Root
      ref={rootRef}
      className="typewriter-root"
      data-embedded={embedded ? "" : undefined}
      data-ready={ready ? "" : undefined}
      data-failed={failed ? "" : undefined}
    >
      <div
        ref={stageRef}
        className="typewriter-stage"
        tabIndex={0}
        role="application"
        aria-label={STAGE_LABEL}
        onPointerDown={onStageDown}
        onPointerUp={onStageUp}
        onBlur={(e) => e.currentTarget.removeAttribute("data-pointer")}
      >
        <canvas ref={glRef} className="typewriter-canvas" />
        <canvas ref={overlayRef} className="typewriter-canvas typewriter-overlay" />
      </div>

      <textarea
        ref={typeRef}
        className="typewriter-type"
        aria-label="Type on the sheet"
        autoCapitalize="sentences"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        rows={1}
        defaultValue=""
      />

      {embedded ? null : (
        <header ref={headRef} className="typewriter-head">
          <h1 className="typewriter-title">Typewriter</h1>
          <p className="typewriter-lede">
            Type on your keyboard. Return <em>throws the carriage</em>; drag the sheet to slide or roll it.
          </p>
          <button type="button" className="typewriter-sound" aria-pressed={sound} onClick={toggleSound}>
            <span className="typewriter-sound-mark" aria-hidden="true" />
            {sound ? "Sound on" : "Sound off"}
          </button>
        </header>
      )}

      {failed ? <p className="typewriter-fallback">This piece needs WebGL 2.</p> : null}
    </Root>
  );
}
