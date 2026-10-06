"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import useNearViewport from "@/app/experiments/useNearViewport";
import usePlateDrift from "@/app/experiments/usePlateDrift";

import BlobField from "./BlobField";
import { FRAMES, frameConfig } from "./blobPresets";
import "./blobs.css";

const EXIT_MS = 450;

export default function BlobPiece({ embedded = false }) {
  const stageRef = useRef(null);
  const near = useNearViewport(stageRef);
  const [index, setIndex] = useState(0);
  const [exiting, setExiting] = useState(false);
  const timerRef = useRef(0);
  usePlateDrift(stageRef, embedded);

  const frame = FRAMES[index];
  const config = useMemo(() => frameConfig(frame), [frame]);

  const step = useCallback((amount) => {
    if (timerRef.current) return;
    setExiting(true);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = 0;
      setIndex((value) => (value + amount + FRAMES.length) % FRAMES.length);
      setExiting(false);
    }, EXIT_MS);
  }, []);

  useEffect(() => () => window.clearTimeout(timerRef.current), []);

  useEffect(() => {
    if (embedded) return undefined;
    const handleKey = (event) => {
      if (event.key === "ArrowRight") step(1);
      if (event.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [embedded, step]);

  return (
    <div
      ref={stageRef}
      className="blobs-piece"
      data-plate=""
      role="button"
      tabIndex={0}
      aria-label="Flower wall, click to change the frame"
      onClick={() => step(1)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          step(1);
        }
      }}
      style={{
        background: config.customBackground ? config.background : undefined,
        color: config.customBackground ? config.textColor : undefined,
      }}
    >
      {near ? <BlobField config={config} embedded introKey={index} exiting={exiting} /> : null}
    </div>
  );
}
