"use client";

import { useEffect, useRef } from "react";

import useNearViewport from "@/app/experiments/useNearViewport";

import InkLoop from "./InkLoop";

const SHEET_LABEL =
  "Ink sheet. A brush draws here by itself; draw with a mouse, finger or pen to take it over. Press Enter or Space to wash it away for the next drawing, Backspace or Delete to wash the sheet clean.";

const revealedSheets = new Set();

function settleReveal(event) {
  if (event.propertyName === "opacity" && event.target.classList.contains("wi-canvas")) event.currentTarget.setAttribute("data-revealed", "");
}

export default function InkSheet({ embedded = false }) {
  const surfaceRef = useRef(null);
  const hostRef = useRef(null);
  const nibRef = useRef(null);
  const loopRef = useRef(null);
  const near = useNearViewport(surfaceRef);
  const revealKey = embedded ? "tile" : "page";

  useEffect(() => {
    if (!near) return undefined;
    const surface = surfaceRef.current;
    if (revealedSheets.has(revealKey)) surface.setAttribute("data-revealed", "");
    const loop = new InkLoop({
      surface,
      host: hostRef.current,
      nib: nibRef.current,
      callbacks: {
        onPainted: () => {
          revealedSheets.add(revealKey);
          surface.setAttribute("data-painted", "true");
        },
        onEngine: (kind) => surface.setAttribute("data-engine", kind),
      },
    });
    loopRef.current = loop;
    loop.start();
    loop.wake();
    return () => {
      loop.destroy();
      loopRef.current = null;
    };
  }, [near, revealKey]);

  const onKeyDown = (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      loopRef.current?.next();
    } else if (e.key === "Backspace" || e.key === "Delete") {
      e.preventDefault();
      loopRef.current?.wipe();
    }
  };

  return (
    <div
      ref={surfaceRef}
      className="wi-sheet"
      role="application"
      tabIndex={0}
      aria-label={SHEET_LABEL}
      onKeyDown={onKeyDown}
      onTransitionEnd={settleReveal}
    >
      <div ref={hostRef} className="wi-paper" />
      <span ref={nibRef} className="wi-nib" data-visible="false" data-down="false" aria-hidden="true" />
    </div>
  );
}
