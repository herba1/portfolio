"use client";

import { useCallback, useRef, useState } from "react";
import "./rotary.css";
import {
  DEFAULT_VALUE,
  MAX_VALUE,
  MIN_VALUE,
  STEP,
  TICKS,
  angleForValue,
  clampValue,
  valueForAngle,
} from "./rotaryParams";

function angleFromPointer(clientX, clientY, rect) {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const dx = clientX - centerX;
  const dy = clientY - centerY;
  return Math.atan2(dx, -dy) * (180 / Math.PI);
}

export default function DetentExperience() {
  const [value, setValue] = useState(DEFAULT_VALUE);
  const [dragging, setDragging] = useState(false);
  const knobRef = useRef(null);

  const handlePointerDown = useCallback((event) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
  }, []);

  const handlePointerMove = useCallback((event) => {
    if (!dragging || !knobRef.current) return;
    const rect = knobRef.current.getBoundingClientRect();
    const angle = angleFromPointer(event.clientX, event.clientY, rect);
    setValue(valueForAngle(angle));
  }, [dragging]);

  const handlePointerUp = useCallback((event) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);
  }, []);

  const handleKeyDown = useCallback((event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      setValue((current) => clampValue(current + STEP));
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      setValue((current) => clampValue(current - STEP));
    } else if (event.key === "Home") {
      event.preventDefault();
      setValue(MIN_VALUE);
    } else if (event.key === "End") {
      event.preventDefault();
      setValue(MAX_VALUE);
    }
  }, []);

  const litCount = Math.round((value - MIN_VALUE) / STEP);

  return (
    <main className="rotary bg-surface text-ink">
      <header className="rotary__head">
        <h1 className="text-title-sm">Detent</h1>
        <p className="text-ui text-ink">One knob. Drag it around.</p>
      </header>

      <div className="rotary__stage">
        <div className="rotary__ticks" aria-hidden="true">
          {TICKS.map((tick, index) => (
            <span
              key={tick}
              className="rotary__tick"
              data-lit={index <= litCount}
              style={{ "--rotary-tick-angle": `${angleForValue(tick)}deg` }}
            />
          ))}
        </div>

        <div
          ref={knobRef}
          className="rotary__knob"
          role="slider"
          tabIndex={0}
          aria-valuemin={MIN_VALUE}
          aria-valuemax={MAX_VALUE}
          aria-valuenow={value}
          aria-valuetext={`${value}`}
          data-dragging={dragging}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleKeyDown}
          style={{ "--rotary-knob-angle": `${angleForValue(value)}deg` }}
        >
          <span className="rotary__knob-mark" />
        </div>

        <div className="rotary__value text-title-lg tabular-nums">{value}</div>
      </div>
    </main>
  );
}
