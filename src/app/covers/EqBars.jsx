"use client";

import { memo, useEffect, useRef } from "react";
import { registerVisual } from "./lib/audioEngine";

// ---------------------------------------------------------------------------
// The four little lines. Bass, low-mid, presence, air — one bar each, driven by
// the real FFT of whatever is playing.
//
// There is no per-frame React here and no JS animation: the engine writes
// --eq0…--eq3 onto this node once a frame and CSS does the rest with a single
// `transform: scaleY()` per bar (see .cv-eq in covers.css). Four composited
// transforms, no layout, no paint. When nothing is playing the vars sit at the
// resting value and a CSS transition eases the bars flat.
// ---------------------------------------------------------------------------
// memo'd: its parents re-render on the engine's ~11Hz clock, and none of that
// concerns these bars — they're driven entirely by CSS variables.
export default memo(function EqBars({ playing, size = 15, className = "" }) {
  const ref = useRef(null);
  useEffect(() => registerVisual(ref.current), []);

  return (
    <span
      ref={ref}
      className={`cv-eq${playing ? " is-playing" : ""}${className ? ` ${className}` : ""}`}
      style={{ "--eq-h": `${size}px` }}
      aria-hidden="true"
    >
      <i />
      <i />
      <i />
      <i />
    </span>
  );
});
