"use client";

import { useCallback, useRef, useState } from "react";

import { INTERVALS } from "./strumScale";

const LAST = INTERVALS.length - 1;
const REACH = 48;
const HOVER_LIFT = 0.6;
const PRESS_LIFT = 0.95;
const MAX_LEAN = 14;

const TICK_HEIGHTS = INTERVALS.map((interval) => Math.round(8 + 16 * Math.log2(interval.ratio)));

export default function StrumRatio({ index, onChange }) {
  const [dragging, setDragging] = useState(false);
  const trackRef = useRef(null);
  const thumbRef = useRef(null);
  const ticksRef = useRef([]);
  const pressedRef = useRef(false);

  const geometry = useCallback(() => {
    const track = trackRef.current;
    if (!track) return null;
    const rect = track.getBoundingClientRect();
    return { left: rect.left, width: Math.max(1, rect.width) };
  }, []);

  const lift = useCallback((clientX, box) => {
    const strength = pressedRef.current ? PRESS_LIFT : HOVER_LIFT;
    ticksRef.current.forEach((tick, tickIndex) => {
      if (!tick) return;
      const x = box.left + (tickIndex / LAST) * box.width;
      const near = Math.max(0, 1 - Math.abs(clientX - x) / REACH);
      tick.style.setProperty("--strum-prox", (1 + strength * near * near * (3 - 2 * near)).toFixed(3));
    });
  }, []);

  const settle = useCallback(() => {
    ticksRef.current.forEach((tick) => tick?.style.setProperty("--strum-prox", "1"));
    thumbRef.current?.style.setProperty("--strum-lean", "0deg");
  }, []);

  const follow = useCallback(
    (clientX) => {
      const box = geometry();
      if (!box) return;
      const progress = Math.min(1, Math.max(0, (clientX - box.left) / box.width));
      const nearest = Math.round(progress * LAST);
      lift(clientX, box);
      if (pressedRef.current) {
        const offset = progress * LAST - nearest;
        thumbRef.current?.style.setProperty("--strum-lean", `${(offset * 2 * MAX_LEAN).toFixed(2)}deg`);
        if (nearest !== index) onChange(nearest);
      }
    },
    [geometry, lift, index, onChange],
  );

  const handlePointerDown = useCallback(
    (event) => {
      if (event.button > 0) return;
      event.currentTarget.setPointerCapture(event.pointerId);
      pressedRef.current = true;
      setDragging(true);
      follow(event.clientX);
    },
    [follow],
  );

  const handlePointerMove = useCallback((event) => follow(event.clientX), [follow]);

  const handlePointerUp = useCallback(
    (event) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
      pressedRef.current = false;
      setDragging(false);
      thumbRef.current?.style.setProperty("--strum-lean", "0deg");
      if (event.pointerType !== "mouse") settle();
      else {
        const box = geometry();
        if (box) lift(event.clientX, box);
      }
    },
    [geometry, lift, settle],
  );

  const handleKeyDown = useCallback(
    (event) => {
      let next = index;
      if (event.key === "ArrowRight" || event.key === "ArrowUp") next = index + 1;
      else if (event.key === "ArrowLeft" || event.key === "ArrowDown") next = index - 1;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = LAST;
      else return;
      event.preventDefault();
      event.stopPropagation();
      next = Math.min(LAST, Math.max(0, next));
      if (next !== index) onChange(next);
    },
    [index, onChange],
  );

  const interval = INTERVALS[index];

  return (
    <div
      className="strum-ratio"
      role="slider"
      tabIndex={0}
      aria-label="Scale ratio"
      aria-valuemin={0}
      aria-valuemax={LAST}
      aria-valuenow={index}
      aria-valuetext={`${interval.name}, ${interval.ratio.toFixed(3)}`}
      data-dragging={dragging ? "true" : "false"}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onPointerLeave={settle}
      onKeyDown={handleKeyDown}
    >
      <div className="strum-ratio__track" ref={trackRef}>
        {INTERVALS.map((entry, tickIndex) => (
          <span
            key={entry.name}
            ref={(element) => {
              ticksRef.current[tickIndex] = element;
            }}
            className="strum-ratio__tick"
            data-lit={tickIndex <= index ? "true" : "false"}
            data-current={tickIndex === index ? "true" : "false"}
            style={{ "--strum-x": tickIndex / LAST, "--strum-h": `${TICK_HEIGHTS[tickIndex]}px` }}
          />
        ))}
        <span ref={thumbRef} className="strum-ratio__thumb" style={{ "--strum-x": index / LAST }} />
      </div>
    </div>
  );
}
