"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import "./rotary.css";
import {
  DEFAULT_VALUE,
  FRICTION,
  MAX_VALUE,
  MIN_VALUE,
  STEP,
  TICKS,
  VELOCITY_STOP,
  angleForValue,
  clampValue,
  snapValue,
  valueForAngle,
} from "./rotaryParams";

function angleFromPointer(clientX, clientY, rect) {
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;
  const dx = clientX - centerX;
  const dy = clientY - centerY;
  return Math.atan2(dx, -dy) * (180 / Math.PI);
}

export default function DetentV2Experience() {
  const [value, setValue] = useState(DEFAULT_VALUE);
  const [dragging, setDragging] = useState(false);
  const [coasting, setCoasting] = useState(false);
  const [settling, setSettling] = useState(false);

  const knobRef = useRef(null);
  const sampleRef = useRef(null);
  const velocityRef = useRef(0);
  const rafRef = useRef(null);

  const stopCoast = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    setCoasting(false);
  }, []);

  const settle = useCallback((raw) => {
    setValue(snapValue(raw));
    setSettling(true);
  }, []);

  const coast = useCallback((startValue) => {
    let current = startValue;
    let lastTime = performance.now();

    const step = (now) => {
      const dt = Math.min(48, now - lastTime);
      lastTime = now;

      velocityRef.current *= FRICTION;
      const next = current + velocityRef.current * dt;
      const clamped = clampValue(next);
      current = clamped;

      if (clamped !== next) {
        velocityRef.current = 0;
      }

      setValue(clamped);

      if (Math.abs(velocityRef.current) < VELOCITY_STOP || clamped === MIN_VALUE || clamped === MAX_VALUE) {
        rafRef.current = null;
        setCoasting(false);
        settle(clamped);
        return;
      }

      rafRef.current = requestAnimationFrame(step);
    };

    rafRef.current = requestAnimationFrame(step);
  }, [settle]);

  const handlePointerDown = useCallback((event) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    stopCoast();
    setSettling(false);
    setDragging(true);
    sampleRef.current = { value, time: performance.now() };
    velocityRef.current = 0;
  }, [stopCoast, value]);

  const handlePointerMove = useCallback((event) => {
    if (!dragging || !knobRef.current) return;
    const rect = knobRef.current.getBoundingClientRect();
    const angle = angleFromPointer(event.clientX, event.clientY, rect);
    const next = snapValue(valueForAngle(angle));

    const now = performance.now();
    const prev = sampleRef.current;
    if (prev) {
      const dt = Math.max(1, now - prev.time);
      velocityRef.current = (next - prev.value) / dt;
    }
    sampleRef.current = { value: next, time: now };

    setValue(next);
  }, [dragging]);

  const handlePointerUp = useCallback((event) => {
    event.currentTarget.releasePointerCapture(event.pointerId);
    setDragging(false);

    if (Math.abs(velocityRef.current) > VELOCITY_STOP * 6) {
      setCoasting(true);
      coast(value);
    } else {
      settle(value);
    }
  }, [coast, settle, value]);

  const handleKeyDown = useCallback((event) => {
    stopCoast();
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      setValue((current) => clampValue(current + STEP));
      setSettling(true);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      setValue((current) => clampValue(current - STEP));
      setSettling(true);
    } else if (event.key === "Home") {
      event.preventDefault();
      setValue(MIN_VALUE);
      setSettling(true);
    } else if (event.key === "End") {
      event.preventDefault();
      setValue(MAX_VALUE);
      setSettling(true);
    }
  }, [stopCoast]);

  useEffect(() => {
    if (!settling) return undefined;
    const timeout = setTimeout(() => setSettling(false), 280);
    return () => clearTimeout(timeout);
  }, [settling]);

  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  const litCount = Math.round((value - MIN_VALUE) / STEP);

  return (
    <main className="rotary bg-surface text-ink">
      <header className="rotary__head">
        <h1 className="text-title-sm">Evolve Detent</h1>
        <p className="text-ui text-ink">One knob. Flick it — it keeps spinning.</p>
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
          id="detent-v2-knob"
          className="rotary__knob"
          role="slider"
          tabIndex={0}
          aria-valuemin={MIN_VALUE}
          aria-valuemax={MAX_VALUE}
          aria-valuenow={value}
          aria-valuetext={`${value}`}
          data-dragging={dragging}
          data-coasting={coasting}
          data-settling={settling}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onKeyDown={handleKeyDown}
          style={{ "--rotary-knob-angle": `${angleForValue(value)}deg` }}
        >
          <span className="rotary__knob-mark" />
        </div>

        <output htmlFor="detent-v2-knob" className="rotary__value text-title-lg tabular-nums">
          {value}
        </output>
      </div>
    </main>
  );
}
