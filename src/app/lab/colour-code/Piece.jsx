"use client";

import { useEffect, useRef } from "react";

import useNearViewport from "@/app/experiments/useNearViewport";

import "./colour-code.css";

const LABEL =
  "A line of text encoded as a row of coloured squares, one colour per letter, beside a card decoder wheel. Type to re-encode the line. Hover or tap a square and the wheel turns to show its letter in the window.";

export default function Piece({ embedded = false }) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const inputRef = useRef(null);
  const near = useNearViewport(rootRef);

  useEffect(() => {
    if (!near) return undefined;
    const root = rootRef.current;
    let cancelled = false;
    let engine = null;
    import("./colourEngine")
      .then(({ createColourCode }) => {
        if (cancelled) return null;
        return createColourCode({ root, canvas: canvasRef.current, input: inputRef.current, embedded });
      })
      .then((made) => {
        if (!made) return;
        if (cancelled) made.destroy();
        else {
          engine = made;
          root.setAttribute("data-ready", "");
        }
      })
      .catch((error) => console.warn("colour-code: could not start", error));
    return () => {
      cancelled = true;
      engine?.destroy();
    };
  }, [near, embedded]);

  const Root = embedded ? "div" : "main";
  return (
    <Root ref={rootRef} className="colour-code" aria-label={LABEL}>
      <canvas ref={canvasRef} className="colour-code__canvas" />
      <input
        ref={inputRef}
        className="colour-code__input"
        type="text"
        aria-label="Text to encode"
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="characters"
        spellCheck={false}
        maxLength={48}
        tabIndex={embedded ? -1 : 0}
      />
    </Root>
  );
}
